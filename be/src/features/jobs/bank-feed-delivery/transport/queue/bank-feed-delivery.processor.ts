import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { BANK_FEED_DELIVERY_QUEUE, DELIVER_BANK_FEED_JOB, type BankFeedDeliveryRecorded } from "@modules/queues/bank-feed-delivery"
import { ProcessBankFeedDeliveryStep } from "../../steps/process-bank-feed-delivery.step"

@Injectable()
/** Consumes the committed bank-feed receipt using the app's existing fenced job runner. */
export class BankFeedDeliveryProcessor extends FencedProcessor {
    override readonly queue: "bank-feed-delivery" = BANK_FEED_DELIVERY_QUEUE
    override readonly definition: JobDefinition<BankFeedDeliveryRecorded> = DELIVER_BANK_FEED_JOB

    constructor(private readonly delivery: ProcessBankFeedDeliveryStep) {
        super()
    }

    /** Resolves the pending receipt in one transaction; the runner refused a malformed payload and judges every failure. */
    async process(job: ClaimedJob): Promise<void> {
        await this.delivery.run(job)
    }
}
