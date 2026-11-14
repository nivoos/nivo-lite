import { Injectable } from "@nestjs/common"
import { VideoRenderDeliveryService } from "@modules/domain/video-compose"
import { AdvancingJobStepPolicy, InjectJobClaims, type ClaimedJob, type JobClaims, type JobStep } from "@modules/platform/jobs"

@Injectable()
/** The one effect of the job: the kept render completion the job names is handed to the one event pipeline and completed. */
export class DeliverRenderStep extends AdvancingJobStepPolicy implements JobStep {
    constructor(
        private readonly renders: VideoRenderDeliveryService,
        @InjectJobClaims() claims: JobClaims,
    ) {
        super(claims, "deliver")
    }

    /** Delivers the completion after the worker's claim has been checked; a failure throws. */
    protected perform(_payload: object, job: ClaimedJob): Promise<unknown> {
        return this.renders.deliver(job)
    }
}
