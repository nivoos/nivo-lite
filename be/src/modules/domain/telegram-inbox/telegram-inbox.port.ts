import type { ClaimedJob } from "@modules/platform/jobs"
import type { TelegramDeliveryRecorded } from "./telegram-inbox.contracts"

/** Consumes a committed Telegram receipt after its worker fence has advanced. */
export interface TelegramReceiptProcessor {
    /** Resolves the durable receipt reference, propagating failures for retry. */
    processRecordedDelivery(message: TelegramDeliveryRecorded, job: ClaimedJob): Promise<void>
}
