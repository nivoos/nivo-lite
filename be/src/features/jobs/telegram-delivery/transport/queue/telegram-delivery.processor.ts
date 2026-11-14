import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { DELIVER_TELEGRAM_JOB, TELEGRAM_DELIVERY_QUEUE, type TelegramDeliveryRecorded } from "@modules/queues/telegram-delivery"
import { ProcessTelegramDeliveryStep } from "../../steps/process-telegram-delivery.step"

@Injectable()
/** Consumes the committed telegram receipt using the app's existing fenced job runner. */
export class TelegramDeliveryProcessor extends FencedProcessor {
    override readonly queue: "telegram-delivery" = TELEGRAM_DELIVERY_QUEUE
    override readonly definition: JobDefinition<TelegramDeliveryRecorded> = DELIVER_TELEGRAM_JOB

    constructor(private readonly delivery: ProcessTelegramDeliveryStep) {
        super()
    }

    /** Resolves the pending receipt in one transaction; the runner refused a malformed payload and judges every failure. */
    async process(job: ClaimedJob): Promise<void> {
        await this.delivery.run(job)
    }
}
