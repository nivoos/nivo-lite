import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectQueueOutbox, type QueueOutbox } from "@modules/platform/queue"
import type { TelegramDeliveryRecorded } from "./telegram-delivery.contracts"
import { DELIVER_TELEGRAM_JOB } from "./telegram-delivery.jobs"

export { TELEGRAM_DELIVERY_QUEUE, isTelegramDeliveryRecorded } from "./telegram-delivery.contracts"
export type { TelegramDeliveryRecorded } from "./telegram-delivery.contracts"

@Injectable()
/** Publishes a receipt reference using the transaction that records it. */
export class TelegramDeliveryQueue {
    constructor(@InjectQueueOutbox() private readonly outbox: QueueOutbox) {}

    /** Uses the intake's dedupe identity so a duplicate cannot create another delivery job. */
    enqueueDeliveryRecorded(message: TelegramDeliveryRecorded, tx: EntityManager): Promise<void> {
        return this.outbox.write(tx, DELIVER_TELEGRAM_JOB.queue, message, {
            job: DELIVER_TELEGRAM_JOB.name,
            dedupeKey: DELIVER_TELEGRAM_JOB.onceKey(message),
        })
    }
}
