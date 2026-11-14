import { Test } from "@nestjs/testing"
import { FakeClock, fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { buildChainRunner, deliveryOf, keptEffectsLedger, networkRefused } from "@tests/fixtures/builders/job-chain-runner.builder"
import { ConnectionsService } from "@modules/domain/connections"
import { DataRecordsService } from "@modules/domain/data-records"
import { DataSyncRunsService } from "@modules/domain/data-sync-runs"
import type { DataSyncRun } from "@modules/domain/data-sync-runs"
import { CLOCK } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { EFFECTS } from "@modules/platform/effects"
import type { Effects } from "@modules/platform/effects"
import { MESSAGE_CATALOG } from "@modules/platform/i18n"
import type { MessageCatalog } from "@modules/platform/i18n"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import type { QueueDelivery } from "@modules/platform/queue"
import { DATA_SYNC_QUEUE, DataSyncQueue, RUN_DATA_SYNC_JOB, type DataSyncPayload } from "@modules/queues/data-sync"
import { CsvImportSyncService } from "./csv-import-sync.service"
import { DataConnectorRegistryService } from "./data-connector-registry.service"
import type { DataConnection } from "./data-hub.contracts"
import { DataHubService } from "./data-hub.service"
import { DataSyncService } from "./data-sync.service"
import { DataHubError, DataHubErrorCode } from "./errors/data-hub.error"

/** The runner reads the workspace of a payload only when it is a uuid. */
const WS = "11111111-1111-4111-8111-111111111111"
const PAYLOAD: DataSyncPayload = { workspaceId: WS, connectionId: "c-1", runId: "run-1" }
const CONNECTION: DataConnection = {
    id: "c-1",
    workspaceId: WS,
    provider: "csv_import",
    name: "Orders",
    status: "connected",
    lastError: null,
    meta: {},
    everyMinutes: 5,
    lastSyncAt: null,
}

/** The two fields of the run row this spec reads. */
interface RunRow {
    state: DataSyncRun["state"]
    error: string | null
}

/** The processor of the job as the feature composes it: one domain method; the dead letter settles the run and the connection. */
class SyncProcessor extends FencedProcessor {
    override readonly queue = DATA_SYNC_QUEUE
    override readonly definition: JobDefinition<DataSyncPayload> = RUN_DATA_SYNC_JOB
    constructor(private readonly sync: DataSyncService) {
        super()
    }
    async process(job: ClaimedJob): Promise<void> {
        await this.sync.run(job)
    }
    override async onFailed(delivery: QueueDelivery, cause: unknown): Promise<void> {
        await this.sync.failed(delivery.payload, cause)
    }
}

const build = async () => {
    const ledger = keptEffectsLedger()
    const effects = mock<Effects>()
    effects.once.mockImplementation(ledger.once)
    const em = mockEntityManager()
    fakeTransaction(em)
    const run: RunRow = { state: "running", error: null }
    const runs = mock<DataSyncRunsService>()
    runs.find.mockImplementation(() =>
        Promise.resolve({ id: "run-1", connectionId: "c-1", trigger: "manual", state: run.state, rows: 0, error: run.error, startedAt: "x", finishedAt: null }),
    )
    runs.finish.mockImplementation((_id, state, _rows, error) => {
        run.state = state
        run.error = error
        return Promise.resolve()
    })
    runs.reopen.mockImplementation(() => {
        run.state = "running"
        run.error = null
        return Promise.resolve()
    })
    const hub = mock<DataHubService>()
    hub.find.mockResolvedValue(CONNECTION)
    hub.credentialOf.mockResolvedValue("credential")
    const connections = mock<ConnectionsService>()
    connections.markSynced.mockResolvedValue(undefined)
    connections.markSyncFailed.mockResolvedValue(undefined)
    const catalog = mock<MessageCatalog>()
    catalog.get.mockImplementation((key) => `text of ${key}`)
    const csv = mock<CsvImportSyncService>({ provider: "csv_import" })
    const registry = mock<DataConnectorRegistryService>()
    registry.has.mockReturnValue(false)
    const moduleRef = await Test.createTestingModule({
        providers: [
            DataSyncService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: em },
            { provide: CLOCK, useValue: new FakeClock("2026-10-12T10:00:00.000Z") },
            { provide: MESSAGE_CATALOG, useValue: catalog },
            { provide: EFFECTS, useValue: effects },
            { provide: DataSyncQueue, useValue: mock<DataSyncQueue>() },
            { provide: ConnectionsService, useValue: connections },
            { provide: DataHubService, useValue: hub },
            { provide: DataRecordsService, useValue: mock<DataRecordsService>() },
            { provide: DataSyncRunsService, useValue: runs },
            { provide: CsvImportSyncService, useValue: csv },
            { provide: DataConnectorRegistryService, useValue: registry },
        ],
    }).compile()
    const service = moduleRef.get(DataSyncService)
    return { processor: new SyncProcessor(service), csv, runs, connections, run }
}

const deliver = (runner: Awaited<ReturnType<typeof buildChainRunner>>, processor: SyncProcessor, attempt: number) =>
    runner.runner.run(processor, deliveryOf(DATA_SYNC_QUEUE, RUN_DATA_SYNC_JOB.name, PAYLOAD, attempt))

describe("data sync chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes", () => {
    it("a source that is down: retried on the waited ladder, then parked once; the run and the connection say failed; the resume syncs", async () => {
        const t = await build()
        const run = await buildChainRunner()
        run.claimed(PAYLOAD)
        t.csv.sync.mockRejectedValue(networkRefused())

        // Starts 1..4 fail transient: a retry after 60, 120, 240, 480 s; nothing is settled, nothing parks.
        for (const attempt of [1, 2, 3, 4]) {
            await expect(deliver(run, t.processor, attempt)).rejects.toMatchObject({ params: { seconds: [60, 120, 240, 480][attempt - 1] } })
        }
        expect(run.claims.park).not.toHaveBeenCalled()
        expect(t.run.state).toBe("running")
        expect(t.connections.markSyncFailed).not.toHaveBeenCalled()

        // Start 5: the ladder is spent: ONE dead letter; the run and the connection are told in one write.
        await deliver(run, t.processor, 5)

        expect(run.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient" }))
        expect(run.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(t.run).toMatchObject({ state: "failed", error: "text of errors.DATA_HUB_SYNC_FAILED" })
        expect(t.connections.markSyncFailed).toHaveBeenCalledWith("c-1", "text of errors.DATA_HUB_SYNC_FAILED", expect.anything())

        // The source is back; a person resumes: the same run is opened again and ends ok.
        t.csv.sync.mockResolvedValue({ rows: 5 })
        run.claimed(PAYLOAD, 1)
        await deliver(run, t.processor, 1)

        expect(t.runs.reopen).toHaveBeenCalledTimes(1)
        expect(t.run.state).toBe("ok")
        expect(run.claims.complete).toHaveBeenCalledTimes(1)
        expect(run.deadLetters.raise).toHaveBeenCalledTimes(1)
    })

    it("a refusal of the domain parks at once (input, no retry spent) and the run carries the refusal's own sentence", async () => {
        const t = await build()
        const run = await buildChainRunner()
        run.claimed(PAYLOAD)
        t.csv.sync.mockRejectedValue(new DataHubError({ code: DataHubErrorCode.Invalid, params: { detail: "wrong password" } }))

        await deliver(run, t.processor, 1)

        expect(t.csv.sync).toHaveBeenCalledTimes(1)
        expect(run.claims.fail).not.toHaveBeenCalled()
        expect(run.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "input", reason: DataHubErrorCode.Invalid }))
        expect(run.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(t.run).toMatchObject({ state: "failed", error: "text of errors.DATA_HUB_INVALID" })
    })
})
