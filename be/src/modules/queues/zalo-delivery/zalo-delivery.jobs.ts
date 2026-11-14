import { defineJob, type JobDefinition } from "@modules/platform/jobs"
import { KEEP_FILE_EFFECT } from "@modules/queues/inbound-delivery"
import { ZALO_DELIVERY_QUEUE, isZaloDeliveryRecorded, type ZaloDeliveryRecorded } from "./zalo-delivery.contracts"

/**
 * The consumer of one recorded Zalo event: the customer message is translated by the provider trigger, its pictures are kept in the shop's store (one effect per file) and the canonical event is handed to the one delivery function (the wake, in the same transaction), then the person and the message are kept and the receipt is completed, all in ONE transaction. A failure throws (the receipt stays pending; the runner retries it on the ladder, then dead-letters it with one item). A customer waits for the answer, so it is `waited`. The job keeps its original name (the queue's), so a job already queued is still consumed.
 */
export const DELIVER_ZALO_JOB: JobDefinition<ZaloDeliveryRecorded> = defineJob<ZaloDeliveryRecorded>({
    name: ZALO_DELIVERY_QUEUE,
    queue: ZALO_DELIVERY_QUEUE,
    ladder: "waited",
    payload: isZaloDeliveryRecorded,
    onceKey: (payload) => `${ZALO_DELIVERY_QUEUE}:${payload.deliveryId}`,
    next: [],
    effects: [KEEP_FILE_EFFECT],
})
