import { Injectable } from "@nestjs/common"
import { InjectJobClaims, payloadOfJob, type ClaimedJob, type JobClaims } from "@modules/platform/jobs"
import { DELIVER_BANK_FEED_JOB } from "@modules/queues/bank-feed-delivery"
import { BankFeedService } from "./bank-feed.service"

@Injectable()
/** Fences the processing of a receipt reference the runner already validated (the raw rows and the trigger). */
export class BankFeedDeliveryService {
    constructor(
        private readonly inbox: BankFeedService,
        @InjectJobClaims() private readonly claims: JobClaims,
    ) {}

    /** Records the step with the token this worker holds, then consumes the receipt; a failure throws (the runner judges it). */
    async process(job: ClaimedJob): Promise<void> {
        const message = payloadOfJob(DELIVER_BANK_FEED_JOB, job)
        await this.claims.advance({
            jobId: job.jobId,
            expectedFencingToken: job.fencingToken,
            step: "bank-feed-delivery",
        })
        await this.inbox.processRecordedFeedDelivery(message)
    }
}
