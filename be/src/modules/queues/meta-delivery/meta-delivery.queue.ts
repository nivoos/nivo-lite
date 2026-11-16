import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectQueueOutbox, type QueueOutbox } from "@modules/platform/queue"
import type { MetaDeliveryRecorded } from "./meta-delivery.contracts"
import { DELIVER_META_JOB } from "./meta-delivery.jobs"

export { META_DELIVERY_QUEUE, isMetaDeliveryRecorded } from "./meta-delivery.contracts"
export type { MetaDeliveryRecorded } from "./meta-delivery.contracts"

@Injectable()
/** Publishes a receipt reference using the transaction that records it. */
export class MetaDeliveryQueue {
    constructor(@InjectQueueOutbox() private readonly outbox: QueueOutbox) {}

    /** Uses the intake's dedupe identity so a duplicate cannot create another delivery job. */
    enqueueDeliveryRecorded(message: MetaDeliveryRecorded, tx: EntityManager): Promise<void> {
        return this.outbox.write(tx, DELIVER_META_JOB.queue, message, {
            job: DELIVER_META_JOB.name,
            dedupeKey: DELIVER_META_JOB.onceKey(message),
        })
    }
}
