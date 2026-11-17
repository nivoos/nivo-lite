import { z } from "zod"
import type { EventKind } from "@starci/nivoos-sdk"
import { keyOf } from "../../package-key.ts"

/** What a deal asks the payment watch of: the deal, the pay code its customer writes in the transfer memo and the amount due. */
export const PayRequestedData = z.strictObject({ dealId: z.string().min(1), payCode: z.string().regex(/^[A-Z]{2,5}[0-9]{4,12}$/u), amount: z.number().int().nonnegative() })

/**
 * `nivo-gtm.pay.requested`: a deal asks for its payment, on the subject `order:<payCode>` (the subject SePay's `sepay.payment.paid` names, so the watch run it opens takes the transfer). The
 * deal's pay workflow emits it with `link: true`, so the watch is its child and its end comes back to the deal as `Ended`. A ninth kind beside the eight of the plan: a bank transfer reaches a run only
 * through the order subject.
 */
export class PayRequested implements EventKind<typeof PayRequestedData> {
    readonly key = keyOf("pay.requested")
    readonly version = 1
    readonly title = { vi: "Yêu cầu thu tiền", en: "Payment requested" }
    readonly event = PayRequestedData
    readonly subjectKind = "order"
    readonly vias = ["internal"] as const
}
