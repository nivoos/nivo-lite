import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { EmitDealPaidOutput } from "../cells/emit-deal-paid.cell.ts"
import { EmitPayRequestedOutput } from "../cells/emit-pay-requested.cell.ts"
import { PostPayNoticeOutput } from "../cells/post-pay-notice.cell.ts"
import { ReadDealOutput } from "../cells/read-deal.cell.ts"
import { SentOutput } from "../cells/sent.ts"
import { UpdateDealOutput } from "../cells/update-deal.cell.ts"
import { Open } from "./steps/open.step.ts"
import { Read } from "./steps/read.step.ts"
import { WriteCode } from "./steps/write-code.step.ts"
import { SendPay } from "./steps/send-pay.step.ts"
import { Watch } from "./steps/watch.step.ts"
import { Settle } from "./steps/settle.step.ts"
import { IsPaid } from "./steps/is-paid.step.ts"
import { IsReminded } from "./steps/is-reminded.step.ts"
import { IsShort } from "./steps/is-short.step.ts"
import { Nudge } from "./steps/nudge.step.ts"
import { RecordPaid } from "./steps/record-paid.step.ts"
import { Announce } from "./steps/announce.step.ts"
import { Paid } from "./steps/paid.step.ts"
import { ShortNotice } from "./steps/short-notice.step.ts"
import { UnpaidNotice } from "./steps/unpaid-notice.step.ts"
import { Short } from "./steps/short.step.ts"
import { Unpaid } from "./steps/unpaid.step.ts"
import { Unreachable } from "./steps/unreachable.step.ts"
import { Declined } from "./steps/declined.step.ts"

/** What a payment watch ends with, as the deal's run reads it from its `Ended` item. */
export const Result = z.strictObject({
    reason: z.string().max(600),
    paid: z.boolean(),
    amount: z.number(),
    transferId: z.string().max(80),
})
/** How the payment watch ended: paid or not, the amount received, the transfer id and the reason it ended. */
export type Result = z.infer<typeof Result>

/** The one state object of a run: the deal written, what was read of it, the pay code written, the watch request (with its round), the reminder, the watch result, the paid record and the notice to the sales room. */
export const State = z.strictObject({
    change: z.strictObject({ objectId: z.string().max(80), version: z.number().int() }).optional(),
    deal: ReadDealOutput.optional(),
    written: UpdateDealOutput.optional(),
    sent: SentOutput.optional(),
    watched: EmitPayRequestedOutput.optional(),
    result: Result.optional(),
    nudged: SentOutput.optional(),
    recorded: UpdateDealOutput.optional(),
    announced: EmitDealPaidOutput.optional(),
    notified: PostPayNoticeOutput.optional(),
})

/**
 * `nivo-gtm.deals-pay` (Thu tiền): the customer said yes (the deal is `accepted`). The deal gets its pay code `NIVO<code>`, the customer is sent the transfer details (a person approves the send, locked), and a
 * payment watch child (`nivo-gtm.deals-pay-watch`, on the order subject SePay names) waits for the transfer. No money in time: ONE reminder (approved the same way) and a second watch; still nothing (`unpaid`), or a short transfer (`short`), ends with ONE notice to the sales room.
 * Paid: the deal is `paid` with the SePay transaction id, and `nivo-gtm.deal.paid` starts the activation.
 */
export class Pay implements Workflow<typeof State> {
    readonly key = keyOf("deals-pay")
    readonly version = 3
    readonly title = { vi: "Thu tiền", en: "Collect the payment" }
    readonly state = State
    readonly start = Open
    readonly steps = [
        Open,
        Read,
        WriteCode,
        SendPay,
        Watch,
        Settle,
        IsPaid,
        IsReminded,
        IsShort,
        Nudge,
        RecordPaid,
        Announce,
        Paid,
        ShortNotice,
        UnpaidNotice,
        Short,
        Unpaid,
        Unreachable,
        Declined,
    ]
}
