import { Test } from "@nestjs/testing"
import { FakeClock, fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { keptEffectsLedger } from "@tests/fixtures/builders/job-chain-runner.builder"
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
import type { ClaimedJob } from "@modules/platform/jobs"
import { DataSyncQueue } from "@modules/queues/data-sync"
import { CsvImportSyncService } from "./csv-import-sync.service"
import { DataConnectorRegistryService } from "./data-connector-registry.service"
import type { DataConnection } from "./data-hub.contracts"
import { DataHubService } from "./data-hub.service"
import { DataSyncService } from "./data-sync.service"

const PAYLOAD = { workspaceId: "ws-1", connectionId: "c-1", runId: "run-1" }
const JOB: ClaimedJob = { jobId: "job-1", kind: "data_sync.run", fencingToken: 1, currentStep: "sync", payload: PAYLOAD }
const CONNECTION: DataConnection = {
    id: "c-1",
    workspaceId: "ws-1",
    provider: "csv_import",
    name: "Orders",
    status: "connected",
    lastError: null,
    meta: {},
    everyMinutes: 5,
    lastSyncAt: null,
}

/** The one field of the run row this spec reads. */
interface RunRow {
    state: DataSyncRun["state"]
}

/** The process "dies" here: the error a write throws when its worker is gone. */
const killed = (): Error => Object.assign(new Error("worker killed"), { code: "ECONNRESET" })

/** A sync service over the semantics of a kept answer; the run row is a one-field store the spec reads. */
const build = async () => {
    const ledger = keptEffectsLedger()
    const effects = mock<Effects>()
    effects.once.mockImplementation(ledger.once)
    const em = mockEntityManager()
    fakeTransaction(em)
    const run: RunRow = { state: "running" }
    const runs = mock<DataSyncRunsService>()
    runs.find.mockImplementation(() =>
        Promise.resolve({ id: "run-1", connectionId: "c-1", trigger: "manual", state: run.state, rows: 0, error: null, startedAt: "x", finishedAt: null }),
    )
    runs.finish.mockImplementation((_id, state) => {
        run.state = state
        return Promise.resolve()
    })
    const hub = mock<DataHubService>()
    hub.find.mockResolvedValue(CONNECTION)
    hub.credentialOf.mockResolvedValue("credential")
    const connections = mock<ConnectionsService>()
    connections.markSynced.mockResolvedValue(undefined)
    const csv = mock<CsvImportSyncService>({ provider: "csv_import" })
    const registry = mock<DataConnectorRegistryService>()
    registry.has.mockReturnValue(false)
    csv.sync.mockResolvedValue({ rows: 7, meta: { cursor: "next" } })
    const moduleRef = await Test.createTestingModule({
        providers: [
            DataSyncService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: em },
            { provide: CLOCK, useValue: new FakeClock("2026-10-12T10:00:00.000Z") },
            { provide: MESSAGE_CATALOG, useValue: mock<MessageCatalog>() },
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
    return { service: moduleRef.get(DataSyncService), ledger, connections, runs, csv, run }
}

describe("data sync chain: the job is run twice, the second run repeats no finished step and no settled effect", () => {
    it("a kill after the pull and before the settle: the second run does not pull again and settles once", async () => {
        const t = await build()
        // The worker dies when it writes the end of the sync: the pull was made and its answer kept.
        t.connections.markSynced.mockRejectedValueOnce(killed())

        await expect(t.service.run(JOB)).rejects.toMatchObject({ code: "ECONNRESET" })

        expect(t.csv.sync).toHaveBeenCalledTimes(1)
        expect(t.runs.finish).not.toHaveBeenCalled()
        expect(t.run.state).toBe("running")

        await expect(t.service.run(JOB)).resolves.toBeUndefined()

        expect(t.csv.sync).toHaveBeenCalledTimes(1)
        expect(t.ledger.rows.get("job-1:pull")?.acts).toBe(1)
        expect(t.connections.markSynced.mock.calls[1]).toEqual(["c-1", { cursor: "next" }, expect.anything()])
        expect(t.runs.finish).toHaveBeenCalledTimes(1)
        expect(t.runs.finish).toHaveBeenCalledWith("run-1", "ok", 7, null, expect.anything())
    })

    it("a kill inside the pull settles nothing: the second run pulls and settles once", async () => {
        const t = await build()
        t.ledger.failNext("job-1:pull", killed())

        await expect(t.service.run(JOB)).rejects.toMatchObject({ code: "ECONNRESET" })

        expect(t.csv.sync).not.toHaveBeenCalled()
        expect(t.connections.markSynced).not.toHaveBeenCalled()

        await expect(t.service.run(JOB)).resolves.toBeUndefined()

        expect(t.csv.sync).toHaveBeenCalledTimes(1)
        expect(t.runs.finish).toHaveBeenCalledTimes(1)
    })

    it("a delivery after the run ended does nothing", async () => {
        const t = await build()
        await t.service.run(JOB)

        await expect(t.service.run(JOB)).resolves.toBeUndefined()

        expect(t.csv.sync).toHaveBeenCalledTimes(1)
        expect(t.runs.finish).toHaveBeenCalledTimes(1)
    })
})
