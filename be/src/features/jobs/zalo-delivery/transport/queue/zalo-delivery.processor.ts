import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { DELIVER_ZALO_JOB, ZALO_DELIVERY_QUEUE, type ZaloDeliveryRecorded } from "@modules/queues/zalo-delivery"
import { ProcessZaloDeliveryStep } from "../../steps/process-zalo-delivery.step"

@Injectable()
/** Consumes the committed zalo receipt using the app's existing fenced job runner. */
export class ZaloDeliveryProcessor extends FencedProcessor {
    override readonly queue: "zalo-delivery" = ZALO_DELIVERY_QUEUE
    override readonly definition: JobDefinition<ZaloDeliveryRecorded> = DELIVER_ZALO_JOB

    constructor(private readonly delivery: ProcessZaloDeliveryStep) {
        super()
    }

    /** Resolves the pending receipt in one transaction; the runner refused a malformed payload and judges every failure. */
    async process(job: ClaimedJob): Promise<void> {
        await this.delivery.run(job)
    }
}
