import { defineJob, type JobDefinition } from "@modules/platform/jobs"
import { KEEP_FILE_EFFECT } from "@modules/queues/inbound-delivery"
import { TELEGRAM_DELIVERY_QUEUE, isTelegramDeliveryRecorded, type TelegramDeliveryRecorded } from "./telegram-delivery.contracts"

/**
 * The consumer of one recorded Telegram update: the message is translated by the provider trigger, its files are addressed and kept in the shop's store (one effect per file) and the canonical event is handed to the one delivery function (the wake, in the same transaction), then the message and the person are kept and the receipt is completed, all in ONE transaction. A failure throws (the receipt stays pending; the runner retries it on the ladder, then dead-letters it with one item). A customer waits for the answer, so it is `waited`. The job keeps its original name (the queue's), so a job already queued is still consumed.
 */
export const DELIVER_TELEGRAM_JOB: JobDefinition<TelegramDeliveryRecorded> = defineJob<TelegramDeliveryRecorded>({
    name: TELEGRAM_DELIVERY_QUEUE,
    queue: TELEGRAM_DELIVERY_QUEUE,
    ladder: "waited",
    payload: isTelegramDeliveryRecorded,
    onceKey: (payload) => `${TELEGRAM_DELIVERY_QUEUE}:${payload.deliveryId}`,
    next: [],
    effects: [KEEP_FILE_EFFECT],
})
