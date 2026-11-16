import { Injectable } from "@nestjs/common"
import { DELIVER_META_JOB } from "@modules/queues/meta-delivery"
import { InjectJobClaims, payloadOfJob, type ClaimedJob, type JobClaims } from "@modules/platform/jobs"
import { InjectMetaReceiptProcessor } from "./meta-inbox.decorators"
import type { MetaReceiptProcessor } from "./meta-inbox.port"

@Injectable()
/** Records the worker fence of a deferred receipt before processing it. */
export class MetaDeliveryService {
    constructor(
        @InjectMetaReceiptProcessor() private readonly receipts: MetaReceiptProcessor,
        @InjectJobClaims() private readonly claims: JobClaims,
    ) {}

    /** Processes the receipt the claimed job names (the runner refused a payload the declaration does not accept); a failure throws. */
    async process(job: ClaimedJob): Promise<void> {
        const message = payloadOfJob(DELIVER_META_JOB, job)
        await this.claims.advance({
            jobId: job.jobId,
            expectedFencingToken: job.fencingToken,
            step: "meta-delivery",
        })
        await this.receipts.processRecordedDelivery(message)
    }
}
