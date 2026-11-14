import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectQueueOutbox, type QueueOutbox } from "@modules/platform/queue"
import type { DataBackupPayload } from "./data-copies.contracts"
import { BACKUP_DATA_JOB } from "./data-copies.jobs"

@Injectable()
/** The typed producer of the data-copies queue: the one way a backup job starts (the ticks themselves are written by platform/jobs). */
export class DataCopiesQueue {
    constructor(@InjectQueueOutbox() private readonly outbox: QueueOutbox) {}

    /** Enqueues the backup of one data set in one slot, in the caller's transaction; the same set and slot written twice is one job. */
    enqueueBackup(payload: DataBackupPayload, tx: EntityManager): Promise<void> {
        return this.outbox.write(tx, BACKUP_DATA_JOB.queue, payload, {
            job: BACKUP_DATA_JOB.name,
            dedupeKey: BACKUP_DATA_JOB.onceKey(payload),
        })
    }
}
