import { defineJob, type JobDefinition } from "@modules/platform/jobs"
import {
    VIDEO_RENDER_DELIVERY_JOB,
    VIDEO_RENDER_DELIVERY_QUEUE,
    isVideoRenderDeliveryRecorded,
    type VideoRenderDeliveryRecorded,
} from "./video-render-delivery.contracts"

/**
 * The delivery of one kept render completion: the row the render door kept is translated by its provider's trigger and handed to the ONE
 * delivery function (the wake of the run that waits for the render), and the row is completed, in ONE transaction. The door only keeps
 * the row and writes this job; a failure to deliver throws, so the runner retries it on the ladder and then dead-letters it with one
 * item (the run no longer waits for its timeout alone). A person waits for the finished video, so it is `waited`.
 */
export const DELIVER_VIDEO_RENDER_JOB: JobDefinition<VideoRenderDeliveryRecorded> = defineJob<VideoRenderDeliveryRecorded>({
    name: VIDEO_RENDER_DELIVERY_JOB,
    queue: VIDEO_RENDER_DELIVERY_QUEUE,
    ladder: "waited",
    payload: isVideoRenderDeliveryRecorded,
    onceKey: (payload) => `${VIDEO_RENDER_DELIVERY_QUEUE}:${payload.provider}:${payload.connectionId}:${payload.key}`,
    next: [],
    effects: [],
})
