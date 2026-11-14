import { FakeClock, fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { Test } from "@nestjs/testing"
import { ConnectionsService } from "@modules/domain/connections"
import { DataRecordsService } from "@modules/domain/data-records"
import { DataSyncRunsService } from "@modules/domain/data-sync-runs"
import type { DataSyncRun } from "@modules/domain/data-sync-runs"
import { CLOCK } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { EFFECTS } from "@modules/platform/effects"
import type { Effects } from "@modules/platform/effects"
import { QueueError, QueueErrorCode } from "@modules/platform/queue"
import type { ClaimedJob } from "@modules/platform/jobs"
import { keptEffectsLedger } from "@tests/fixtures/builders/job-chain-runner.builder"
import { MESSAGE_CATALOG } from "@modules/platform/i18n"
import type { MessageCatalog } from "@modules/platform/i18n"
import { DataSyncQueue } from "@modules/queues/data-sync"
import { CsvImportSyncService } from "./csv-import-sync.service"
import type { DatabaseSyncService } from "./database-sync.service"
import { DATA_PROVIDERS } from "./data-hub.contracts"
import type { DataConnection, DataProvider } from "./data-hub.contracts"
import { DataHubService } from "./data-hub.service"
import { DataSyncService } from "./data-sync.service"
import { DataHubError, DataHubErrorCode } from "./errors/data-hub.error"
import { DataConnectorRegistryService } from "./data-connector-registry.service"
import type { TelegramUserSyncService } from "./telegram-user-sync.service"

const actor = { principalId: "u-1", workspaceId: "ws-1" }
const payload = { workspaceId: "ws-1", connectionId: "c-1", runId: "run-1" }
/** The job a worker holds for the sync (a resume is `resumeCount` 1 and above). */
const jobOf = (data: object = payload, resumeCount = 0): ClaimedJob => ({
    jobId: "job-1",
    kind: "data_sync.run",
    fencingToken: 1,
    currentStep: "sync",
    payload: data,
    ...(resumeCount > 0 ? { resumeCount } : {}),
})
/** What the runner hands `onFailed`: a flow failure naming the class and reason, with the failure itself kept. */
const parked = (failureClass: "transient" | "input" | "code" | "config", reason: string, cause?: unknown): QueueError =>
    new QueueError({ code: QueueErrorCode.FlowFailure, params: { failureClass, reason }, cause })
const connectionOf = (provider: DataProvider = "csv_import"): DataConnection => ({
    id: "c-1",
    workspaceId: "ws-1",
    provider,
    name: "Orders",
    status: "connected",
    lastError: null,
    meta: {},
    everyMinutes: 5,
    lastSyncAt: null,
})
const runOf = (id = "run-1", connectionId = "c-1"): DataSyncRun => ({
    id,
    connectionId,
    trigger: "manual",
    state: "running",
    rows: 0,
    error: null,
    startedAt: "2026-10-12T10:00:00.000Z",
    finishedAt: null,
})

const buildKit = async (registerCsv = true) => {
    const entityManager = mockEntityManager()
    const transaction = fakeTransaction(entityManager)
    const clock = new FakeClock("2026-10-12T10:00:00.000Z")
    const catalog = mock<MessageCatalog>()
    const ledger = keptEffectsLedger()
    const effects = mock<Effects>()
    effects.once.mockImplementation(ledger.once)
    const queue = mock<DataSyncQueue>()
    const connections = mock<ConnectionsService>()
    const hub = mock<DataHubService>()
    const records = mock<DataRecordsService>()
    const runs = mock<DataSyncRunsService>()
    const csv = mock<CsvImportSyncService>(registerCsv ? { provider: "csv_import" } : {})
    const database = mock<DatabaseSyncService>({ provider: "database" })
    const telegramUser = mock<TelegramUserSyncService>({ provider: "telegram_user" })
    const mailboxes = new DataConnectorRegistryService()
    mailboxes.register(database)
    mailboxes.register(telegramUser)
    hub.owner.mockResolvedValue({ role: "owner", displayName: "Owner" })
    hub.own.mockResolvedValue(connectionOf())
    hub.find.mockResolvedValue(connectionOf())
    hub.credentialOf.mockResolvedValue("credential")
    runs.open.mockResolvedValue(runOf())
    runs.find.mockResolvedValue(runOf())
    runs.finish.mockResolvedValue(undefined)
    runs.reopen.mockResolvedValue(undefined)
    queue.enqueueSync.mockResolvedValue(undefined)
    connections.markSynced.mockResolvedValue(undefined)
    connections.markSyncFailed.mockResolvedValue(undefined)
    catalog.get.mockReturnValue("Try again")
    const moduleRef = await Test.createTestingModule({
        providers: [
            DataSyncService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: entityManager },
            { provide: CLOCK, useValue: clock },
            { provide: MESSAGE_CATALOG, useValue: catalog },
            { provide: EFFECTS, useValue: effects },
            { provide: DataSyncQueue, useValue: queue },
            { provide: ConnectionsService, useValue: connections },
            { provide: DataHubService, useValue: hub },
            { provide: DataRecordsService, useValue: records },
            { provide: DataSyncRunsService, useValue: runs },
            { provide: CsvImportSyncService, useValue: csv },
            { provide: DataConnectorRegistryService, useValue: mailboxes },
        ],
    }).compile()
    return {
        service: moduleRef.get(DataSyncService),
        entityManager,
        transaction,
        clock,
        catalog,
        ledger,
        queue,
        connections,
        hub,
        records,
        runs,
        csv,
        database,
        telegramUser,
        mailboxes,
    }
}

const build = async () => {
    const { service } = await buildKit()
    return service
}

describe("DataSyncService", () => {
    it("ignores a dead letter whose payload is not a sync", async () => {
        const service = await build()

        await expect(service.failed({ tick: false }, parked("input", "X"))).resolves.toBeUndefined()
    })

    it("authorizes and queues a manual run in the transaction that opens it", async () => {
        const { service, entityManager, transaction, hub, runs, queue } = await buildKit()
        const run = runOf()
        runs.open.mockResolvedValue(run)

        await expect(service.request(actor, "c-1")).resolves.toBe(run)

        const tx = runs.open.mock.calls[0]?.[0]
        expect(tx).toBeDefined()
        expect(tx).not.toBe(entityManager)
        expect(hub.owner).toHaveBeenCalledWith(actor)
        expect(hub.own).toHaveBeenCalledWith("ws-1", "c-1")
        expect(entityManager.transaction).toHaveBeenCalledTimes(1)
        expect(runs.open).toHaveBeenCalledWith(tx, "ws-1", "c-1", "manual")
        expect(queue.enqueueSync).toHaveBeenCalledWith(payload, tx)
        expect(transaction.outcomes).toEqual(["commit"])
    })

    it("refuses a missing opened run and rolls back without queueing", async () => {
        const { service, transaction, runs, queue } = await buildKit()
        runs.open.mockResolvedValue(null)

        await expect(service.request(actor, "c-1")).rejects.toMatchObject({ code: DataHubErrorCode.SyncFailed })

        expect(queue.enqueueSync).not.toHaveBeenCalled()
        expect(transaction.outcomes).toEqual(["rollback"])
    })

    it("rolls back when enqueueing the manual run fails", async () => {
        const { service, transaction, queue } = await buildKit()
        const failure = new TypeError("queue unavailable")
        queue.enqueueSync.mockRejectedValue(failure)

        await expect(service.request(actor, "c-1")).rejects.toBe(failure)

        expect(transaction.outcomes).toEqual(["rollback"])
    })

    it("does not open or queue a run when owner authorization fails", async () => {
        const { service, entityManager, hub, queue } = await buildKit()
        const failure = new DataHubError({ code: DataHubErrorCode.NotFound })
        hub.owner.mockRejectedValue(failure)

        await expect(service.request(actor, "c-1")).rejects.toBe(failure)

        expect(hub.own).not.toHaveBeenCalled()
        expect(entityManager.transaction).not.toHaveBeenCalled()
        expect(queue.enqueueSync).not.toHaveBeenCalled()
    })

    it("authorizes and returns the requested workspace run", async () => {
        const { service, hub, runs } = await buildKit()
        const run = runOf()
        runs.find.mockResolvedValue(run)

        await expect(service.status(actor, "run-1")).resolves.toBe(run)

        expect(hub.owner).toHaveBeenCalledWith(actor)
        expect(runs.find).toHaveBeenCalledWith("ws-1", "run-1")
    })
})

describe("DataSyncService", () => {
    it("refuses a missing status run with the not-found code", async () => {
        const { service, runs } = await buildKit()
        runs.find.mockResolvedValue(null)

        await expect(service.status(actor, "absent")).rejects.toMatchObject({ code: DataHubErrorCode.NotFound })

        expect(runs.find).toHaveBeenCalledWith("ws-1", "absent")
    })

    it("claims up to twenty due connections and, in ONE transaction, opens and queues the run of each", async () => {
        const { service, entityManager, transaction, connections, runs, queue } = await buildKit()
        connections.claimDueSyncs.mockResolvedValue([
            { id: "c-1", workspaceId: "ws-1" },
            { id: "c-2", workspaceId: "ws-2" },
        ])
        runs.open.mockResolvedValueOnce(runOf()).mockResolvedValueOnce(runOf("run-2", "c-2"))

        await expect(service.queueDue()).resolves.toBe(2)

        const tx = runs.open.mock.calls[0]?.[0]
        expect(tx).toBeDefined()
        expect(tx).not.toBe(entityManager)
        expect(runs.open.mock.calls[1]?.[0]).toBe(tx)
        expect(connections.claimDueSyncs).toHaveBeenCalledWith(DATA_PROVIDERS, 20, tx)
        expect(entityManager.transaction).toHaveBeenCalledTimes(1)
        expect(runs.open).toHaveBeenNthCalledWith(1, tx, "ws-1", "c-1", "schedule")
        expect(runs.open).toHaveBeenNthCalledWith(2, tx, "ws-2", "c-2", "schedule")
        expect(queue.enqueueSync).toHaveBeenNthCalledWith(1, payload, tx)
        expect(queue.enqueueSync).toHaveBeenNthCalledWith(2, { workspaceId: "ws-2", connectionId: "c-2", runId: "run-2" }, tx)
        expect(transaction.outcomes).toEqual(["commit"])
    })

    it("rolls the claim back with the runs when queueing one of them fails (nothing is claimed for nothing)", async () => {
        const { service, transaction, connections, queue } = await buildKit()
        connections.claimDueSyncs.mockResolvedValue([{ id: "c-1", workspaceId: "ws-1" }])
        queue.enqueueSync.mockRejectedValue(new TypeError("queue unavailable"))

        await expect(service.queueDue()).rejects.toThrow("queue unavailable")

        expect(transaction.outcomes).toEqual(["rollback"])
    })

    it("answers zero and queues nothing when no sync is due", async () => {
        const { service, connections, queue } = await buildKit()
        connections.claimDueSyncs.mockResolvedValue([])

        await expect(service.queueDue()).resolves.toBe(0)

        expect(queue.enqueueSync).not.toHaveBeenCalled()
    })
})

describe("DataSyncService", () => {
    it("passes the credential, counts written rows and exposes the exact two-minute deadline", async () => {
        const { service, hub, records, csv, clock, connections, runs } = await buildKit()
        const first = [{ externalId: "order-1", data: { paid: true } }]
        const second = [{ externalId: "customer-1", data: { name: "An" } }]
        const meta = { cursor: "next" }
        records.upsert.mockResolvedValueOnce(2).mockResolvedValueOnce(3)
        csv.sync.mockImplementation(async (context) => {
            expect(context.connection).toEqual(connectionOf())
            expect(context.credential).toBe("credential")
            expect(context.isExpired()).toBe(false)
            clock.advance(119_999)
            expect(context.isExpired()).toBe(false)
            clock.advance(1)
            expect(context.isExpired()).toBe(true)
            await expect(context.upsert("order", first)).resolves.toBe(2)
            await expect(context.upsert("customer", second)).resolves.toBe(3)
            return { rows: 9, meta }
        })

        await expect(service.run(jobOf())).resolves.toBeUndefined()

        expect(hub.find).toHaveBeenCalledWith("ws-1", "c-1")
        expect(hub.credentialOf).toHaveBeenCalledWith("c-1")
        expect(records.upsert).toHaveBeenNthCalledWith(1, "ws-1", "c-1", "order", first)
        expect(records.upsert).toHaveBeenNthCalledWith(2, "ws-1", "c-1", "customer", second)
        // The connection and the run are settled in ONE transaction.
        const tx = connections.markSynced.mock.calls[0]?.[2]
        expect(tx).toBeDefined()
        expect(connections.markSynced).toHaveBeenCalledWith("c-1", meta, tx)
        expect(runs.finish).toHaveBeenCalledWith("run-1", "ok", 9, null, tx)
    })

    it.each(DATA_PROVIDERS.filter((provider) => provider !== "openapi"))("dispatches %s with an empty missing credential and no result meta", async (provider) => {
        const kit = await buildKit()
        const connector = {
            csv_import: kit.csv,
            database: kit.database,
            telegram_user: kit.telegramUser,
        }[provider]
        kit.hub.find.mockResolvedValue(connectionOf(provider))
        kit.hub.credentialOf.mockResolvedValue(null)
        connector.sync.mockResolvedValue({ rows: 4 })

        await expect(kit.service.run(jobOf())).resolves.toBeUndefined()

        expect(connector.sync).toHaveBeenCalledTimes(1)
        expect(connector.sync).toHaveBeenCalledWith(
            expect.objectContaining({ connection: connectionOf(provider), credential: "" }),
        )
        expect(kit.connections.markSynced).toHaveBeenCalledWith("c-1", {}, expect.anything())
        expect(kit.runs.finish).toHaveBeenCalledWith("run-1", "ok", 4, null, expect.anything())
    })

    it("throws a failure of the pull as it is (the runner classifies it) and settles nothing", async () => {
        const { service, csv, records, connections, runs } = await buildKit()
        const failure = new DataHubError({ code: DataHubErrorCode.Invalid, params: { detail: "source invalid" } })
        records.upsert.mockResolvedValueOnce(2)
        csv.sync.mockImplementation(async (context) => {
            await context.upsert("order", [{ externalId: "a", data: {} }])
            return Promise.reject(failure)
        })

        await expect(service.run(jobOf())).rejects.toBe(failure)

        expect(connections.markSynced).not.toHaveBeenCalled()
        expect(connections.markSyncFailed).not.toHaveBeenCalled()
        expect(runs.finish).not.toHaveBeenCalled()
    })
})

describe("DataSyncService: the typed ends of a sync job", () => {
    it.each([
        { run: null, why: "its run is gone" },
        { run: { ...runOf(), state: "ok" as const }, why: "its run already ended ok (a run killed after its settle)" },
        { run: { ...runOf(), state: "failed" as const }, why: "its run failed and nobody resumed the job" },
    ])("ends with nothing to do when $why", async ({ run }) => {
        const { service, runs, hub, ledger } = await buildKit()
        runs.find.mockResolvedValue(run)

        await expect(service.run(jobOf())).resolves.toBeUndefined()

        expect(hub.find).not.toHaveBeenCalled()
        expect(ledger.rows.size).toBe(0)
        expect(runs.finish).not.toHaveBeenCalled()
    })

    it("opens a failed run again when a person resumed the job, and syncs it", async () => {
        const { service, runs, csv } = await buildKit()
        runs.find.mockResolvedValue({ ...runOf(), state: "failed" })
        csv.sync.mockResolvedValue({ rows: 3 })

        await expect(service.run(jobOf(payload, 1))).resolves.toBeUndefined()

        expect(runs.reopen).toHaveBeenCalledWith("run-1")
        expect(runs.finish).toHaveBeenCalledWith("run-1", "ok", 3, null, expect.anything())
    })

    it("ends the run as failed with the sentence of a source that is gone, and returns (no dead letter for a deleted connection)", async () => {
        const { service, hub, catalog, runs, csv } = await buildKit()
        hub.find.mockResolvedValue(null)
        catalog.get.mockReturnValue("Connection gone")

        await expect(service.run(jobOf())).resolves.toBeUndefined()

        expect(catalog.get).toHaveBeenCalledWith("errors.DATA_HUB_NOT_FOUND", {}, "vi")
        expect(runs.finish).toHaveBeenCalledWith("run-1", "failed", 0, "Connection gone")
        expect(csv.sync).not.toHaveBeenCalled()
    })

    it("throws a typed not-found when no connector serves the provider (a setting the runner parks as input)", async () => {
        const { service, hub, csv } = await buildKit(false)

        await expect(service.run(jobOf())).rejects.toMatchObject({ code: DataHubErrorCode.NotFound })

        expect(hub.credentialOf).not.toHaveBeenCalled()
        expect(csv.sync).not.toHaveBeenCalled()
    })

    it("refuses a payload that is not a sync as a flow failure of class input", async () => {
        const { service } = await buildKit()

        await expect(service.run(jobOf({ tick: true }))).rejects.toMatchObject({ params: { failureClass: "input" } })
    })
})

describe("DataSyncService: the dead letter", () => {
    it("settles the run and the connection in one transaction with the refusal's own sentence (its params kept)", async () => {
        const { service, catalog, connections, runs, transaction } = await buildKit()
        const refusal = new DataHubError({ code: DataHubErrorCode.Invalid, params: { detail: "source invalid" } })
        catalog.get.mockReturnValue("r".repeat(501))

        await expect(service.failed(payload, parked("input", "DATA_HUB_INVALID", refusal))).resolves.toBeUndefined()

        expect(catalog.get).toHaveBeenCalledWith("errors.DATA_HUB_INVALID", { detail: "source invalid" }, "vi")
        const tx = connections.markSyncFailed.mock.calls[0]?.[2]
        expect(tx).toBeDefined()
        expect(connections.markSyncFailed).toHaveBeenCalledWith("c-1", "r".repeat(500), tx)
        expect(runs.finish).toHaveBeenCalledWith("run-1", "failed", 0, "r".repeat(500), tx)
        expect(transaction.outcomes).toEqual(["commit"])
    })

    it.each([parked("code", "boom", new TypeError("x")), parked("transient", "ECONNREFUSED"), new Error("not a dead letter")])(
        "says the general sentence for a failure that names no refusal of the domain: %#",
        async (cause) => {
            const { service, catalog, runs } = await buildKit()

            await service.failed(payload, cause)

            expect(catalog.get).toHaveBeenCalledWith("errors.DATA_HUB_SYNC_FAILED", {}, "vi")
            expect(runs.finish).toHaveBeenCalledWith("run-1", "failed", 0, "Try again", expect.anything())
        },
    )
})

describe("DataSyncService: a sandbox account (provider sandbox)", () => {
    const SANDBOX_CONNECTION: DataConnection = { ...connectionOf("database"), sandbox: true }

    it("resolves the sandbox connector of a sandbox account through the registry and reads no credential", async () => {
        const { service, hub, database, mailboxes, runs } = await buildKit()
        const sandboxConnector = mock<DatabaseSyncService>({ provider: "database" })
        mailboxes.register({ live: database, sandbox: sandboxConnector })
        hub.find.mockResolvedValue(SANDBOX_CONNECTION)
        sandboxConnector.sync.mockResolvedValue({ rows: 2 })

        await expect(service.run(jobOf())).resolves.toBeUndefined()

        expect(sandboxConnector.sync).toHaveBeenCalledWith(expect.objectContaining({ connection: SANDBOX_CONNECTION, credential: "" }))
        expect(database.sync).not.toHaveBeenCalled()
        expect(hub.credentialOf).not.toHaveBeenCalled()
        expect(runs.finish).toHaveBeenCalledWith("run-1", "ok", 2, null, expect.anything())
    })

    it("never answers a live connector for a sandbox account: a provider without a sandbox twin throws the typed refusal, nothing is pulled", async () => {
        const { service, hub, database, runs } = await buildKit()
        hub.find.mockResolvedValue(SANDBOX_CONNECTION)

        await expect(service.run(jobOf())).rejects.toMatchObject({ code: "PROVIDER_SANDBOX_MISSING" })

        expect(database.sync).not.toHaveBeenCalled()
        expect(runs.finish).not.toHaveBeenCalled()
    })

    it("never answers a live connector for a sandbox account of any other data provider", async () => {
        const { service, hub, csv } = await buildKit()
        hub.find.mockResolvedValue({ ...connectionOf("csv_import"), sandbox: true })

        await expect(service.run(jobOf())).rejects.toBeDefined()

        expect(csv.sync).not.toHaveBeenCalled()
    })
})
