import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import {
    DELIVER_VIDEO_RENDER_JOB,
    VIDEO_RENDER_DELIVERY_QUEUE,
    type VideoRenderDeliveryRecorded,
} from "@modules/queues/video-render-delivery"
import { DeliverRenderStep } from "../../steps/deliver-render.step"

@Injectable()
/** The processor of the video-render delivery job: the runner claims, validates and settles it; `process` delegates to the one step. */
export class DeliverVideoRenderProcessor extends FencedProcessor {
    override readonly queue: "video-render-delivery" = VIDEO_RENDER_DELIVERY_QUEUE
    override readonly definition: JobDefinition<VideoRenderDeliveryRecorded> = DELIVER_VIDEO_RENDER_JOB

    constructor(private readonly deliver: DeliverRenderStep) {
        super()
    }

    /** Delivers the kept completion; a failure throws (the runner retries it on its ladder, then one dead letter); a stale token throws the fenced-out error before the effect. */
    async process(job: ClaimedJob): Promise<void> {
        await this.deliver.run(job)
    }
}
