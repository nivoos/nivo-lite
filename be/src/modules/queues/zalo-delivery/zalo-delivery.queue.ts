import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectQueueOutbox, type QueueOutbox } from "@modules/platform/queue"
import type { ZaloDeliveryRecorded } from "./zalo-delivery.contracts"
import { DELIVER_ZALO_JOB } from "./zalo-delivery.jobs"

export { ZALO_DELIVERY_QUEUE, isZaloDeliveryRecorded } from "./zalo-delivery.contracts"
export type { ZaloDeliveryRecorded } from "./zalo-delivery.contracts"

@Injectable()
/** Publishes a receipt reference using the transaction that records it. */
export class ZaloDeliveryQueue {
    constructor(@InjectQueueOutbox() private readonly outbox: QueueOutbox) {}

    /** Uses the intake's dedupe identity so a duplicate cannot create another delivery job. */
    enqueueDeliveryRecorded(message: ZaloDeliveryRecorded, tx: EntityManager): Promise<void> {
        return this.outbox.write(tx, DELIVER_ZALO_JOB.queue, message, {
            job: DELIVER_ZALO_JOB.name,
            dedupeKey: DELIVER_ZALO_JOB.onceKey(message),
        })
    }
}
