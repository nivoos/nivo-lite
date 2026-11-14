import { Injectable } from "@nestjs/common"
import { TeamChatTagDeliveryService } from "@modules/domain/team-chat"
import { AdvancingJobStepPolicy, InjectJobClaims, type ClaimedJob, type JobClaims, type JobStep } from "@modules/platform/jobs"

@Injectable()
/** The one effect of the job: the tag the job names is handed to the one event pipeline, in the api (the one app that drives runs). */
export class DeliverTagStep extends AdvancingJobStepPolicy implements JobStep {
    constructor(
        private readonly tags: TeamChatTagDeliveryService,
        @InjectJobClaims() claims: JobClaims,
    ) {
        super(claims, "deliver")
    }

    /** Delivers the tag after the worker's claim has been checked. */
    protected perform(payload: object, _job: ClaimedJob): Promise<unknown> {
        return this.tags.deliverJob(payload)
    }
}
