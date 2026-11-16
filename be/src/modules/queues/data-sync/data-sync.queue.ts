import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectQueueOutbox, type QueueOutbox } from "@modules/platform/queue"

/** The queue name: the contract between this producer, the minute tick and the processors of the data-sync jobs (the durable queue name). */
export const DATA_SYNC_QUEUE = "data_sync"

/** The jobs of the data-sync queue: the minute tick that queues the syncs that are due (the tick's own job name, as `JOB_TICKS` writes it) and one sync of one connection. */
export enum DataSyncJob {
    /** The minute tick: queues the scheduled syncs that are due. */
    Tick = "data_sync",
    /** One sync of one connection, with its run row. */
    Run = "data_sync.run",
}

/** The payload of one sync: the connection to read and the run row that records it. */
export interface DataSyncPayload {
    /** The workspace of the connection: the queue limits how many syncs of one workspace run at once. */
    readonly workspaceId: string
    /** The connection to sync. */
    readonly connectionId: string
    /** The `data_sync_runs` row opened for this sync. */
    readonly runId: string
}

/** The identity of one sync job: its run row (the same key written twice is one job). */
export const dataSyncDedupeKey = (payload: DataSyncPayload): string => `${DataSyncJob.Run}:${payload.runId}`

/** The payload of one scheduler tick: the due scheduled syncs are queued. */
export interface DataSyncTickPayload {
    /** Marks the tick. */
    readonly tick: true
}

/** True when a job payload is the payload of one sync. */
export const isDataSyncPayload = (value: unknown): value is DataSyncPayload =>
    typeof value === "object" &&
    value !== null &&
    "connectionId" in value &&
    typeof value.connectionId === "string" &&
    "runId" in value &&
    typeof value.runId === "string" &&
    "workspaceId" in value &&
    typeof value.workspaceId === "string"

/** True when a job payload is a scheduler tick. */
export const isDataSyncTickPayload = (value: unknown): value is DataSyncTickPayload =>
    typeof value === "object" && value !== null && "tick" in value && value.tick === true

@Injectable()
/** The typed producer of the data-sync queue: the one way a sync job starts. */
export class DataSyncQueue {
    constructor(@InjectQueueOutbox() private readonly outbox: QueueOutbox) {}

    /** Enqueues one sync in the caller's transaction: the job exists exactly when the run row commits. */
    enqueueSync(payload: DataSyncPayload, tx: EntityManager): Promise<void> {
        return this.outbox.write(tx, DATA_SYNC_QUEUE, payload, {
            job: DataSyncJob.Run,
            dedupeKey: dataSyncDedupeKey(payload),
        })
    }
}
