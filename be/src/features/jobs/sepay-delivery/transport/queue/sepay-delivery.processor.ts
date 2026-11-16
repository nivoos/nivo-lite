import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { DELIVER_SEPAY_JOB, SEPAY_DELIVERY_QUEUE, type SepayDeliveryRecorded } from "@modules/queues/sepay-delivery"
import { ProcessSepayDeliveryStep } from "../../steps/process-sepay-delivery.step"

@Injectable()
/** Consumes the committed sepay receipt using the app's existing fenced job runner. */
export class SepayDeliveryProcessor extends FencedProcessor {
    override readonly queue: "sepay-delivery" = SEPAY_DELIVERY_QUEUE
    override readonly definition: JobDefinition<SepayDeliveryRecorded> = DELIVER_SEPAY_JOB

    constructor(private readonly delivery: ProcessSepayDeliveryStep) {
        super()
    }

    /** Settles the pending receipt in one transaction; the runner refused a malformed payload and judges every failure. */
    async process(job: ClaimedJob): Promise<void> {
        await this.delivery.run(job)
    }
}
