import type { ClaimedJob } from "@modules/platform/jobs"
import type { ZaloDeliveryRecorded } from "@modules/queues/zalo-delivery"

/** The domain effect performed after a recorded delivery passes its worker fence. */
export interface ZaloDeliveryConsumer {
    /** Resolves and atomically processes a committed receipt; `job` is the delivery job whose id keys the effects of the files the message carries. */
    processRecordedDelivery(message: ZaloDeliveryRecorded, job: ClaimedJob): Promise<void>
}
