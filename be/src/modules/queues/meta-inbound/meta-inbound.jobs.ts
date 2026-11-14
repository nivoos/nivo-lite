import { defineJob, type JobDefinition } from "@modules/platform/jobs"
import { isMetaInboundPayload, type MetaInboundPayload } from "./meta-inbound.contracts"
import { META_INBOUND_QUEUE } from "./meta-inbound.queue"

/**
 * The handoff of one stored Meta event to the chatbot's front door: a direct message with words is translated by its platform's trigger
 * and delivered (the wake, in one transaction); every other event, a switched-off account and a removed account are TYPED ENDS that
 * return and are logged with their outcome. A failure throws (the runner retries it on the ladder, then dead-letters it with one item).
 * A customer waits for the answer, so it is `waited`. The job keeps its original name (the queue's).
 */
export const META_INBOUND_JOB: JobDefinition<MetaInboundPayload> = defineJob<MetaInboundPayload>({
    name: META_INBOUND_QUEUE,
    queue: META_INBOUND_QUEUE,
    ladder: "waited",
    payload: isMetaInboundPayload,
    onceKey: (payload) => `${META_INBOUND_QUEUE}:${payload.connectionId}:${payload.event.event_key}`,
    next: [],
    effects: [],
})
