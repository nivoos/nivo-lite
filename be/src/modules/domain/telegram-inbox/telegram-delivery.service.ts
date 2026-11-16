import { Injectable } from "@nestjs/common"
import { InjectJobClaims, payloadOfJob, type ClaimedJob, type JobClaims } from "@modules/platform/jobs"
import { DELIVER_TELEGRAM_JOB } from "@modules/queues/telegram-delivery"
import { InjectTelegramReceiptProcessor } from "./telegram-inbox.decorators"
import type { TelegramReceiptProcessor } from "./telegram-inbox.port"

@Injectable()
/** Advances the fence of a receipt job and consumes the receipt (the runner already refused a payload the declaration does not accept). */
export class TelegramDeliveryService {
    constructor(
        @InjectTelegramReceiptProcessor() private readonly inbox: TelegramReceiptProcessor,
        @InjectJobClaims() private readonly claims: JobClaims,
    ) {}

    /** A stale fence prevents every receipt effect; a failure throws. */
    async process(job: ClaimedJob): Promise<void> {
        const payload = payloadOfJob(DELIVER_TELEGRAM_JOB, job)
        await this.claims.advance({
            jobId: job.jobId,
            expectedFencingToken: job.fencingToken,
            step: "telegram-delivery",
        })
        await this.inbox.processRecordedDelivery(payload, job)
    }
}
