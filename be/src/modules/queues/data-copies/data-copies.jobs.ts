import { defineJob, type JobDefinition, type JobEffectDeclaration } from "@modules/platform/jobs"
import {
    DATA_COPIES_QUEUE,
    DataCopiesJob,
    dataBackupDedupeKey,
    isDataBackupPayload,
    isDataCopiesTickPayload,
    type DataBackupPayload,
    type DataCopiesTickPayload,
} from "./data-copies.contracts"

/**
 * The outside effect of writing the export to ONE driver (git, s3): keyed `<jobId>:data.copy-write:<driver id>`. A driver write of an
 * export it already holds answers `changed: 0` and writes nothing, so a write whose outcome was lost in a crash is made again under the
 * same key (`repeatable`), never twice into the copies. Its answer (where the copy is, what changed) is kept on the ledger row.
 */
export const DATA_COPY_WRITE_EFFECT: JobEffectDeclaration = { name: "data.copy-write", settle: "repeatable" }

/** The hourly tick: queues one backup job for each data set and the slot it falls in. Nobody waits for it (`background`). */
export const BACKUP_DUE_JOB: JobDefinition<DataCopiesTickPayload> = defineJob<DataCopiesTickPayload>({
    name: DataCopiesJob.BackupDue,
    queue: DATA_COPIES_QUEUE,
    ladder: "background",
    payload: isDataCopiesTickPayload,
    onceKey: () => DataCopiesJob.BackupDue,
    next: [DataCopiesJob.Backup],
    effects: [],
})

/** One backup of one data set in one slot: export once, skip when nothing changed, else write every driver. The once key is the set and its slot. */
export const BACKUP_DATA_JOB: JobDefinition<DataBackupPayload> = defineJob<DataBackupPayload>({
    name: DataCopiesJob.Backup,
    queue: DATA_COPIES_QUEUE,
    ladder: "background",
    payload: isDataBackupPayload,
    onceKey: dataBackupDedupeKey,
    next: [],
    effects: [DATA_COPY_WRITE_EFFECT],
})

/** The daily verify: opens the newest copy of every driver, restores it into scratch stores and compares. It only reads, so it declares no effect. */
export const VERIFY_DATA_JOB: JobDefinition<DataCopiesTickPayload> = defineJob<DataCopiesTickPayload>({
    name: DataCopiesJob.Verify,
    queue: DATA_COPIES_QUEUE,
    ladder: "background",
    payload: isDataCopiesTickPayload,
    onceKey: () => DataCopiesJob.Verify,
    next: [],
    effects: [],
})
