import { Injectable } from "@nestjs/common"
import { WebsiteSubmissionDeliveryService } from "@modules/domain/inbox-leads"
import { AdvancingJobStepPolicy, InjectJobClaims, type ClaimedJob, type JobClaims, type JobStep } from "@modules/platform/jobs"

@Injectable()
/** The one effect of the job: the stored submission the job names is handed to the one event pipeline, in the api (the one app that drives runs). */
export class DeliverSubmissionStep extends AdvancingJobStepPolicy implements JobStep {
    constructor(
        private readonly submissions: WebsiteSubmissionDeliveryService,
        @InjectJobClaims() claims: JobClaims,
    ) {
        super(claims, "deliver")
    }

    /** Delivers the submission after the worker's claim has been checked. */
    protected perform(payload: object, _job: ClaimedJob): Promise<unknown> {
        return this.submissions.deliverJob(payload)
    }
}
