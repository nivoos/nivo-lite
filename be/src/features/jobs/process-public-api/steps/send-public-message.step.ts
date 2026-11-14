import { Injectable } from "@nestjs/common"
import { PublicMessageDeliveryService } from "@modules/domain/public-api"
import { AdvancingJobStepPolicy, InjectJobClaims, type ClaimedJob, type JobClaims, type JobStep } from "@modules/platform/jobs"

@Injectable()
/** The one effect of the send job: the reply an accepted API message owes goes to the person's channel through the delivery ledger. */
export class SendPublicMessageStep extends AdvancingJobStepPolicy implements JobStep {
    constructor(
        private readonly deliveries: PublicMessageDeliveryService,
        @InjectJobClaims() claims: JobClaims,
    ) {
        super(claims, "send")
    }

    /** Sends the reply after the worker's claim has been checked; a resumed job is a person deciding to send an uncertain reply again. */
    protected perform(_payload: object, job: ClaimedJob): Promise<unknown> {
        return this.deliveries.sendJob(job)
    }
}
