import { defineJob, type JobDefinition } from "@modules/platform/jobs"
import type { BankFeedDeliveryRecorded } from "./bank-feed-delivery.contracts"
import { BANK_FEED_DELIVERY_QUEUE, isBankFeedDeliveryRecorded } from "./bank-feed-delivery.queue"

/**
 * The consumer of one recorded payment-feed delivery: it keeps the movements, marks the connection as fed, hands the new movements to
 * the account's trigger (a wake in the same transaction) and completes the receipt, all in ONE transaction, so a failure anywhere leaves
 * the receipt pending and the job retried; nothing is swallowed (a wake that failed to be written fails the job). Money is waited on by
 * the person who paid, so it is `waited`. The job keeps its original name (the queue's), so a job already queued is still consumed.
 */
export const DELIVER_BANK_FEED_JOB: JobDefinition<BankFeedDeliveryRecorded> = defineJob<BankFeedDeliveryRecorded>({
    name: BANK_FEED_DELIVERY_QUEUE,
    queue: BANK_FEED_DELIVERY_QUEUE,
    ladder: "waited",
    payload: isBankFeedDeliveryRecorded,
    onceKey: (payload) => `${BANK_FEED_DELIVERY_QUEUE}:${payload.provider}:${payload.deliveryId}`,
    next: [],
    effects: [],
})
