import { defineJob, type JobDefinition, type JobEffectDeclaration } from "@modules/platform/jobs"
import {
    DATA_SYNC_QUEUE,
    DataSyncJob,
    dataSyncDedupeKey,
    isDataSyncPayload,
    isDataSyncTickPayload,
    type DataSyncPayload,
    type DataSyncTickPayload,
} from "./data-sync.queue"

/**
 * The outside effect of one sync: the pull from the owner's own system (a mailbox, a database, a personal Telegram account, a file).
 * It reads, and writes only rows that are written by key, so it is made again under the same key when its outcome is lost; its answer
 * (the rows it wrote and the facts to keep on the connection) is kept, so a run that was killed after the pull does not pull again.
 */
export const DATA_PULL_EFFECT: JobEffectDeclaration = { name: "data.pull", settle: "repeatable" }

/**
 * One sync of one connection and its run row. The owner who pressed "Sync now" watches the run, so it is on the `waited` ladder. When
 * it finishes it settles the run and the connection in one transaction. The once key is the run row.
 */
export const RUN_DATA_SYNC_JOB: JobDefinition<DataSyncPayload> = defineJob<DataSyncPayload>({
    name: DataSyncJob.Run,
    queue: DATA_SYNC_QUEUE,
    ladder: "waited",
    payload: isDataSyncPayload,
    onceKey: dataSyncDedupeKey,
    next: [],
    effects: [DATA_PULL_EFFECT],
})

/** The minute tick: claims the connections whose scheduled sync is due and, in one transaction, opens a run and queues one sync job for each. Nobody waits for it (`background`). */
export const QUEUE_DUE_SYNCS_JOB: JobDefinition<DataSyncTickPayload> = defineJob<DataSyncTickPayload>({
    name: DataSyncJob.Tick,
    queue: DATA_SYNC_QUEUE,
    ladder: "background",
    payload: isDataSyncTickPayload,
    onceKey: () => DataSyncJob.Tick,
    next: [DataSyncJob.Run],
    effects: [],
})
