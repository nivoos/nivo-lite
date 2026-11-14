import { Injectable } from "@nestjs/common"
import type { ZaloDeliveryConsumer } from "./zalo-delivery.port"
import { DELIVER_ZALO_JOB } from "@modules/queues/zalo-delivery"
import { payloadOfJob, type ClaimedJob, type JobClaims } from "@modules/platform/jobs"

@Injectable()
/** The fenced step that resolves a committed zalo receipt. */
export class ZaloDeliveryPolicy {
    /** Records the worker's fence before the domain consumer can perform its receipt effect (the runner already refused a payload the declaration does not accept). */
    async run(job: ClaimedJob, claims: JobClaims, inbox: ZaloDeliveryConsumer): Promise<void> {
        const message = payloadOfJob(DELIVER_ZALO_JOB, job)
        await claims.advance({
            jobId: job.jobId,
            expectedFencingToken: job.fencingToken,
            step: "zalo-delivery",
        })
        await inbox.processRecordedDelivery(message, job)
    }
}
