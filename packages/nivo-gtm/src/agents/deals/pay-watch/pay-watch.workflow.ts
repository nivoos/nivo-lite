import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { PayRequestedData } from "../../../common/events/pay-requested.event.ts"
import { keyOf } from "../../../package-key.ts"
import { CheckAmountOutput } from "../cells/check-amount.cell.ts"
import { Hear } from "./steps/hear.step.ts"
import { AwaitPayment } from "./steps/await-payment.step.ts"
import { Check } from "./steps/check.step.ts"
import { ShortCheck } from "./steps/short-check.step.ts"
import { Paid } from "./steps/paid.step.ts"
import { Short } from "./steps/short.step.ts"
import { Expired } from "./steps/expired.step.ts"

/** What a transfer carries (the `sepay.payment.paid` event): the order code, the SePay transaction, the amount. */
export const Payment = z.strictObject({
    orderCode: z.string().max(80),
    transferId: z.string().max(80),
    amount: z.number(),
    content: z.string().max(1000),
    accountNumber: z.string().max(40),
    transactionDate: z.string().max(40),
})
/** One bank transfer the watch matched to the pay code. */
export type Payment = z.infer<typeof Payment>
/** The `pay.requested` event that starts a payment watch. */
export type Request = z.infer<typeof PayRequestedData>

/** What the watch ends with: every end step names it, and the deal's run reads it typed from its `Ended` item. */
export const PayWatchOutput = z.strictObject({ paid: z.boolean(), amount: z.number(), transferId: z.string().max(80) })

/** The one state object of a run: what the deal asked, the transfer that came and the amount check. */
export const State = z.strictObject({
    request: PayRequestedData.optional(),
    payment: Payment.optional(),
    check: CheckAmountOutput.optional(),
})

/**
 * `nivo-gtm.deals-pay-watch` (Theo dõi thanh toán): a CHILD of the deal's pay run, on the order subject `order:<payCode>`. It waits for the SePay transfer whose memo carries the pay code (`sepay.payment.paid`
 * of the `sepay-nivo` account) up to the hours of the deal setting `unpaidHours` (72 by default), compares the money with the deal's amount and ends `paid`, `short` or `expired`. The pay run reads the end.
 */
export class PayWatch implements Workflow<typeof State> {
    readonly key = keyOf("deals-pay-watch")
    readonly version = 2
    readonly title = { vi: "Theo dõi thanh toán", en: "Watch for the payment" }
    readonly state = State
    readonly output = PayWatchOutput
    readonly start = Hear
    readonly steps = [Hear, AwaitPayment, Check, ShortCheck, Paid, Short, Expired]
}
