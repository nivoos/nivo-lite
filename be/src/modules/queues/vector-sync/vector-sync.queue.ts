import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectQueueOutbox, type QueueOutbox } from "@modules/platform/queue"
import { vectorSyncDelayOf, type VectorReconcilePayload, type VectorSyncPayload } from "./vector-sync.contracts"
import { RECONCILE_VECTORS_JOB, SYNC_VECTORS_JOB } from "./vector-sync.jobs"

/** The payload of the reconcile follow-up job. */
export interface VectorReconcileFollowUp extends VectorReconcilePayload {
    /** When the run that used its whole budget ended, epoch milliseconds: it keys the follow-up, so one run asks for one. */
    readonly resumedAt: number
}

@Injectable()
/**
 * The typed producer of the vector-sync queue: the one way a change of Postgres rows reaches the vector index. Postgres first: the
 * job is written in the transaction that changes the rows, so it exists exactly when the change does, and the index follows after
 * the commit. Nothing writes to the index inside a request.
 */
export class VectorSyncQueue {
    constructor(@InjectQueueOutbox() private readonly outbox: QueueOutbox) {}

    /**
     * Enqueues the sync of the rows a change touched, in the caller's transaction. The changes of one document inside one window
     * (`SOURCE_SYNC_WINDOW_MS`) are one job, run when the window closes.
     */
    enqueueSync(payload: VectorSyncPayload, tx: EntityManager): Promise<void> {
        return this.outbox.write(tx, SYNC_VECTORS_JOB.queue, payload, {
            job: SYNC_VECTORS_JOB.name,
            dedupeKey: SYNC_VECTORS_JOB.onceKey(payload),
            delayMs: vectorSyncDelayOf(payload),
        })
    }

    /** Enqueues the follow-up of a reconcile run that used its whole budget, in the caller's transaction. */
    enqueueReconcile(payload: VectorReconcileFollowUp, tx: EntityManager): Promise<void> {
        return this.outbox.write(tx, RECONCILE_VECTORS_JOB.queue, payload, {
            job: RECONCILE_VECTORS_JOB.name,
            dedupeKey: RECONCILE_VECTORS_JOB.onceKey(payload),
        })
    }
}
