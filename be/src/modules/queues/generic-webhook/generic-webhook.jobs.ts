import { defineJob, type JobDefinition } from "@modules/platform/jobs"
import {
    GENERIC_WEBHOOK_QUEUE,
    GenericWebhookJob,
    genericWebhookKey,
    isGenericWebhookPayload,
    type GenericWebhookPayload,
} from "./generic-webhook.contracts"

/**
 * The delivery of one verified generic webhook receipt: the endpoint's connection row names the workspace, the delivery becomes the
 * inbound event it is and goes to the door that wakes the agents, in one transaction. The sender may be a customer's system that waits
 * for the effect, so it is `waited`. The once key is the delivery's own key (one per delivery id). A delivery for an endpoint that is
 * gone is a typed end that returns (logged); a failure throws and the runner classifies it.
 */
export const DELIVER_GENERIC_WEBHOOK_JOB: JobDefinition<GenericWebhookPayload> = defineJob<GenericWebhookPayload>({
    name: GenericWebhookJob.Deliver,
    queue: GENERIC_WEBHOOK_QUEUE,
    ladder: "waited",
    payload: isGenericWebhookPayload,
    onceKey: (payload) => genericWebhookKey(payload.deliveryId),
    next: [],
    effects: [],
})
