import { defineJob, type JobDefinition } from "@modules/platform/jobs"
import { SEPAY_DELIVERY_QUEUE, isSepayDeliveryRecorded, type SepayDeliveryRecorded } from "./sepay-delivery.queue"

/**
 * The consumer of one recorded SePay billing transfer: the order a transfer pays is settled in SQL and the receipt is completed in ONE
 * transaction; a failure throws (the receipt and the unpaid order stay pending; the runner retries on the ladder, then dead-letters with
 * one item). The person who paid waits, so it is `waited`. The job keeps its original name (the queue's), so a job already queued is
 * still consumed.
 */
export const DELIVER_SEPAY_JOB: JobDefinition<SepayDeliveryRecorded> = defineJob<SepayDeliveryRecorded>({
    name: SEPAY_DELIVERY_QUEUE,
    queue: SEPAY_DELIVERY_QUEUE,
    ladder: "waited",
    payload: isSepayDeliveryRecorded,
    onceKey: (payload) => `${SEPAY_DELIVERY_QUEUE}:${payload.deliveryId}`,
    next: [],
    effects: [],
})
