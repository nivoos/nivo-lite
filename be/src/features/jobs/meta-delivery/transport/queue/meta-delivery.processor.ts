import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { DELIVER_META_JOB, META_DELIVERY_QUEUE, type MetaDeliveryRecorded } from "@modules/queues/meta-delivery"
import { ProcessMetaDeliveryStep } from "../../steps/process-meta-delivery.step"

@Injectable()
/** Consumes the committed meta receipt using the app's existing fenced job runner. */
export class MetaDeliveryProcessor extends FencedProcessor {
    override readonly queue: "meta-delivery" = META_DELIVERY_QUEUE
    override readonly definition: JobDefinition<MetaDeliveryRecorded> = DELIVER_META_JOB

    constructor(private readonly delivery: ProcessMetaDeliveryStep) {
        super()
    }

    /** Resolves the pending receipt in one transaction; the runner refused a malformed payload and judges every failure. */
    async process(job: ClaimedJob): Promise<void> {
        await this.delivery.run(job)
    }
}
