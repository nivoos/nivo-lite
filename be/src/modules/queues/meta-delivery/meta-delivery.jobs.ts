import { defineJob, type JobDefinition } from "@modules/platform/jobs"
import { META_INBOUND_QUEUE } from "@modules/queues/meta-inbound"
import { META_DELIVERY_QUEUE, isMetaDeliveryRecorded, type MetaDeliveryRecorded } from "./meta-delivery.contracts"

/**
 * The consumer of one recorded Meta event: the person and the message are kept, the event's window is opened and its handoff job (`META_INBOUND_QUEUE`, the name the meta-inbound declaration carries) is written, and the receipt is completed, all in ONE transaction, so the next job exists iff the receipt is completed. A failure throws (the receipt stays pending; the runner retries it on the ladder, then dead-letters it with one item). A customer waits for the answer, so it is `waited`. The job keeps its original name (the queue's), so a job already queued is still consumed.
 */
export const DELIVER_META_JOB: JobDefinition<MetaDeliveryRecorded> = defineJob<MetaDeliveryRecorded>({
    name: META_DELIVERY_QUEUE,
    queue: META_DELIVERY_QUEUE,
    ladder: "waited",
    payload: isMetaDeliveryRecorded,
    onceKey: (payload) => `${META_DELIVERY_QUEUE}:${payload.deliveryId}`,
    next: [META_INBOUND_QUEUE],
    effects: [],
})
