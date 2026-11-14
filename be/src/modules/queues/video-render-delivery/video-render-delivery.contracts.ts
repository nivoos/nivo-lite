import { isRecord } from "@modules/platform/primitives"

/** The durable queue of the deferred render-completion consumer: the contract between the render door's intake and the delivery job. */
export const VIDEO_RENDER_DELIVERY_QUEUE = "video-render-delivery"

/** The job name inside the queue: a kept render completion is handed to the one event pipeline. */
export const VIDEO_RENDER_DELIVERY_JOB = "video-render.deliver"

/**
 * A committed render completion, consumed by the delivery job: the kept `<provider>.render` row of the account is named by its provider,
 * its connection and its key (ids only; the job reads the row again).
 */
export interface VideoRenderDeliveryRecorded {
    /** The compose provider that rendered it. */
    readonly provider: string
    /** The connection the render webhook came in on. */
    readonly connectionId: string
    /** The key of the kept row (the provider's render id). */
    readonly key: string
}

const isFilledText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0

/** True when a job payload is the reference of a kept render completion. */
export const isVideoRenderDeliveryRecorded = (value: unknown): value is VideoRenderDeliveryRecorded =>
    isRecord(value) && isFilledText(value.provider) && isFilledText(value.connectionId) && isFilledText(value.key)
