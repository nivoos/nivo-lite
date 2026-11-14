import { Injectable } from "@nestjs/common"
import { PaymentOrderRequestsService } from "@modules/domain/payment-order-requests"
import { AdvancingJobStepPolicy, InjectJobClaims, type ClaimedJob, type JobClaims, type JobStep } from "@modules/platform/jobs"

@Injectable()
/** The one effect of the job: makes the payment order a member asked for and answers the request row. */
export class PlaceOrderStep extends AdvancingJobStepPolicy implements JobStep {
    constructor(
        private readonly requests: PaymentOrderRequestsService,
        @InjectJobClaims() claims: JobClaims,
    ) {
        super(claims, "place")
    }

    /** Makes the order after the worker's claim has been checked: one domain method, the job passed down. */
    protected perform(_payload: object, job: ClaimedJob): Promise<unknown> {
        return this.requests.answer(job)
    }
}
