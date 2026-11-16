import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import {
    BACKUP_DATA_JOB,
    BACKUP_DUE_JOB,
    DATA_COPIES_QUEUE,
    type DataBackupPayload,
    type DataCopiesTickPayload,
} from "@modules/queues/data-copies"
import { BackupDueStep } from "../../steps/backup-due.step"
import { DataBackupStep } from "../../steps/data-backup.step"

@Injectable()
/** The processor of the hourly tick job: the one step queues a backup job for each data set and its slot. */
export class BackupDueProcessor extends FencedProcessor {
    override readonly queue: "data_copies" = DATA_COPIES_QUEUE
    override readonly definition: JobDefinition<DataCopiesTickPayload> = BACKUP_DUE_JOB

    constructor(private readonly due: BackupDueStep) {
        super()
    }

    /** Queues the due backups; a stale token throws the fenced-out error from the guarded write before the effect. */
    async process(job: ClaimedJob): Promise<void> {
        await this.due.run(job)
    }
}

@Injectable()
/**
 * The processor of the backup job: the runner claims and settles it; `process` delegates to the one step. A configuration refusal (the copy
 * outgrew git), a driver that failed for good or a bug is a dead letter with ONE item for a person; a transient driver failure is retried on the
 * background ladder, and a retry never writes a copy twice.
 */
export class DataBackupProcessor extends FencedProcessor {
    override readonly queue: "data_copies" = DATA_COPIES_QUEUE
    override readonly definition: JobDefinition<DataBackupPayload> = BACKUP_DATA_JOB

    constructor(private readonly backup: DataBackupStep) {
        super()
    }

    /** Runs the one step; a stale token throws the fenced-out error from the guarded write before the effect. */
    async process(job: ClaimedJob): Promise<void> {
        await this.backup.run(job)
    }
}
