import { defineJob, type JobDefinition, type JobEffectDeclaration } from "@modules/platform/jobs"
import { N8N_QUEUE, N8N_WEBHOOK_JOB, isN8nWebhookPayload, type N8nWebhookPayload } from "./n8n.queue"

/**
 * The outside effect of posting one signed delivery to a webhook receiver. Declared `repeatable`: when its outcome is lost in a crash
 * the same POST is made again, and the receiver dedupes on the `x-nivo-delivery` header (the delivery id, the same on every try), so
 * a second POST is the same delivery, not a second event. Only a 2xx answer is kept on the ledger row; a failure releases the intent.
 */
export const WEBHOOK_POST_EFFECT: JobEffectDeclaration = { name: "webhook.post", settle: "repeatable" }

/**
 * The job of one outgoing webhook delivery: post a business event to a webhook connection of the workspace. Nobody watches it, so it is
 * `background`. The once key is the delivery id (connection and occurrence), the dedupe key the producer always wrote.
 */
export const EMIT_WEBHOOK_JOB: JobDefinition<N8nWebhookPayload> = defineJob<N8nWebhookPayload>({
    name: N8N_WEBHOOK_JOB,
    queue: N8N_QUEUE,
    ladder: "background",
    payload: isN8nWebhookPayload,
    onceKey: (payload) => `${N8N_WEBHOOK_JOB}:${payload.deliveryId}`,
    next: [],
    effects: [WEBHOOK_POST_EFFECT],
})
