import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { ConnectionsService, type ConnectionActor } from "@modules/domain/connections"
import { DataRecordsService } from "@modules/domain/data-records"
import { DataSyncRunsService, type DataSyncRun, type DataSyncTrigger } from "@modules/domain/data-sync-runs"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { DomainError } from "@modules/platform/errors"
import { InjectEffects, type Effects, type EffectResult } from "@modules/platform/effects"
import { InjectMessageCatalog, type MessageCatalog } from "@modules/platform/i18n"
import { deadLetterCauseOf, payloadOfJob, type ClaimedJob } from "@modules/platform/jobs"
import { eachInOrder } from "@modules/platform/primitives"
import { DATA_PULL_EFFECT, DataSyncQueue, RUN_DATA_SYNC_JOB, isDataSyncPayload } from "@modules/queues/data-sync"
import { CsvImportSyncService } from "./csv-import-sync.service"
import { DATA_PROVIDERS, type DataConnection, type DataConnector, type DataProvider } from "./data-hub.contracts"
import { DataHubService } from "./data-hub.service"
import { DataHubError, DataHubErrorCode } from "./errors/data-hub.error"
import { DataConnectorRegistryService } from "./data-connector-registry.service"

/** How long one sync may run before it stops early and the next one continues. */
const SYNC_BUDGET_MS = 120_000
/** How many due scheduled syncs one tick queues. */
const DUE_PER_TICK = 20
const REASON_MAX = 500

/** What one pull answered and the ledger keeps: the rows it wrote and the public facts to merge into the connection. */
interface Pulled {
    readonly rows: number
    readonly meta: Readonly<Record<string, string>>
}

/** One member of a kept ledger result that is an object, or undefined. */
const memberOf = (kept: EffectResult | undefined, key: string): EffectResult | undefined =>
    typeof kept === "object" && kept !== null && !Array.isArray(kept) ? Object.entries(kept).find(([name]) => name === key)?.[1] : undefined

/** The pull a kept ledger result stands for; a result of another shape is a refusal of the stored answer (input). */
const pulledFrom = (kept: EffectResult): Pulled => {
    const rows = memberOf(kept, "rows")
    const meta = memberOf(kept, "meta")
    if (typeof rows !== "number" || typeof meta !== "object" || meta === null || Array.isArray(meta)) {
        throw new DataHubError({ code: DataHubErrorCode.SyncFailed })
    }
    const facts = Object.entries(meta).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    return { rows, meta: Object.fromEntries(facts) }
}

@Injectable()
/** Runs the syncs of a workspace's own systems into the hub, records each run, and queues the manual and the scheduled ones. */
export class DataSyncService {
    private readonly connectors: ReadonlyMap<DataProvider, DataConnector>

    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectClock() private readonly clock: Clock,
        @InjectMessageCatalog() private readonly catalog: MessageCatalog,
        @InjectEffects() private readonly effects: Effects,
        private readonly queue: DataSyncQueue,
        private readonly connections: ConnectionsService,
        private readonly hub: DataHubService,
        private readonly records: DataRecordsService,
        private readonly runs: DataSyncRunsService,
        csv: CsvImportSyncService,
        private readonly registry: DataConnectorRegistryService,
    ) {
        // Only the import of a file is here: it has no outside system, so no sandbox. Every other connector (database, personal Telegram) is resolved per ACCOUNT by the registry (live or sandbox).
        this.connectors = new Map<DataProvider, DataConnector>([csv].map((connector) => [connector.provider, connector]))
    }

    /** "Sync now" (owner): opens a run and queues the job that does it; the run is what the owner then polls. */
    async request(actor: ConnectionActor, connectionId: string): Promise<DataSyncRun> {
        await this.hub.owner(actor)
        await this.hub.own(actor.workspaceId, connectionId)
        return this.entityManager.transaction(async (tx) => {
            const run = await this.open(tx, actor.workspaceId, connectionId, "manual")
            await this.queue.enqueueSync({ workspaceId: actor.workspaceId, connectionId, runId: run.id }, tx)
            return run
        })
    }

    /** One run of the workspace (owner); a missing one is a typed not-found. */
    async status(actor: ConnectionActor, runId: string): Promise<DataSyncRun> {
        await this.hub.owner(actor)
        const run = await this.runs.find(actor.workspaceId, runId)
        if (run === null) throw new DataHubError({ code: DataHubErrorCode.NotFound })
        return run
    }

    /**
     * Runs one queued sync: the job's one domain method. A run that is gone, or that already ended (ok, or failed and not resumed), is
     * a typed end (returned): the sync is not made twice. A source that is gone (the connection was deleted or disconnected) ends the
     * run as failed with that sentence and returns. Anything else THROWS: the runner retries a transient failure on the job's ladder and
     * dead-letters the rest; a failed run is opened again when a person resumed the job. The pull is one outside effect keyed by the job
     * (its answer is kept), and the run and the connection are settled in ONE transaction, so a run killed after the pull never pulls
     * again and a run killed before it settles nothing.
     */
    async run(job: ClaimedJob): Promise<void> {
        const payload = payloadOfJob(RUN_DATA_SYNC_JOB, job)
        const run = await this.runs.find(payload.workspaceId, payload.runId)
        if (run === null || run.state === "ok") return
        if (run.state === "failed") {
            if ((job.resumeCount ?? 0) === 0) return
            await this.runs.reopen(payload.runId)
        }
        const connection = await this.hub.find(payload.workspaceId, payload.connectionId)
        if (connection === null) {
            await this.runs.finish(payload.runId, "failed", 0, this.sentenceOf(new DataHubError({ code: DataHubErrorCode.NotFound })))
            return
        }
        const connector = this.connectorOf(connection)
        if (connector === undefined) throw new DataHubError({ code: DataHubErrorCode.NotFound })
        const pulled = await this.pull(job, connection, connector)
        await this.entityManager.transaction(async (tx) => {
            await this.connections.markSynced(connection.id, pulled.meta, tx)
            await this.runs.finish(payload.runId, "ok", pulled.rows, null, tx)
        })
    }

    /** Queues one sync for every connection whose scheduled sync is due (the minute tick), the job's one domain method: the claim, the runs and the jobs commit together. */
    queueDue(): Promise<number> {
        return this.entityManager.transaction(async (tx) => {
            const due = await this.connections.claimDueSyncs(DATA_PROVIDERS, DUE_PER_TICK, tx)
            await eachInOrder(due, async (connection) => {
                const run = await this.open(tx, connection.workspaceId, connection.id, "schedule")
                await this.queue.enqueueSync({ workspaceId: connection.workspaceId, connectionId: connection.id, runId: run.id }, tx)
            })
            return due.length
        })
    }

    /**
     * The sync job was dead-lettered (one item for a person): its run and its connection say it failed, with the refusal's own sentence
     * (a domain refusal's text, read from the failure the runner kept) or a general one, so the owner stops waiting; a resume opens the
     * run again.
     */
    async failed(payload: unknown, cause: unknown): Promise<void> {
        if (!isDataSyncPayload(payload)) return
        const dead = deadLetterCauseOf(cause)
        const reason = this.sentenceOf(dead !== undefined && (dead.failureClass === "input" || dead.failureClass === "config") ? dead.failure : undefined)
        await this.entityManager.transaction(async (tx) => {
            await this.connections.markSyncFailed(payload.connectionId, reason, tx)
            await this.runs.finish(payload.runId, "failed", 0, reason, tx)
        })
    }

    /** The pull of one sync through the effects port: keyed `<jobId>:pull`, its answer (rows written, facts to keep) kept on the ledger. */
    private pull(job: ClaimedJob, connection: DataConnection, connector: DataConnector): Promise<Pulled> {
        const deadline = this.clock.now().getTime() + SYNC_BUDGET_MS
        return this.effects.once<Pulled>(`${job.jobId}:pull`, DATA_PULL_EFFECT, {
            act: async () => {
                const result = await connector.sync({
                    connection,
                    // A sandbox account holds no secret: its credential is never read.
                    credential: connection.sandbox === true ? "" : ((await this.hub.credentialOf(connection.id)) ?? ""),
                    upsert: (entity, list) => this.records.upsert(connection.workspaceId, connection.id, entity, list),
                    isExpired: () => this.clock.now().getTime() >= deadline,
                })
                return { rows: result.rows, meta: result.meta ?? {} }
            },
            keep: (pulled) => ({ rows: pulled.rows, meta: pulled.meta }),
            from: (kept) => pulledFrom(kept),
        })
    }

    /**
     * The connector that serves a connection. A registered provider's account (or any sandbox account) goes through the registry's
     * `portFor`, THE ONE SWITCH: a live account its live connector, a sandbox account its sandbox twin or the typed refusal
     * `PROVIDER_SANDBOX_MISSING`, never a live connector.
     */
    private connectorOf(connection: DataConnection): DataConnector | undefined {
        if (connection.sandbox === true || this.registry.has(connection.provider)) {
            return this.registry.portFor({ provider: connection.provider, sandbox: connection.sandbox === true })
        }
        return this.connectors.get(connection.provider)
    }

    private async open(
        tx: EntityManager,
        workspaceId: string,
        connectionId: string,
        trigger: DataSyncTrigger,
    ): Promise<DataSyncRun> {
        const run = await this.runs.open(tx, workspaceId, connectionId, trigger)
        if (run === null) throw new DataHubError({ code: DataHubErrorCode.SyncFailed })
        return run
    }

    /** The sentence the owner reads for a failed sync: a refusal's own text (with its params), or a general one for anything else. */
    private sentenceOf(failure: unknown): string {
        if (failure instanceof DomainError) {
            return this.catalog.get(`errors.${failure.code}`, failure.params, "vi").slice(0, REASON_MAX)
        }
        return this.catalog.get("errors.DATA_HUB_SYNC_FAILED", {}, "vi")
    }
}
