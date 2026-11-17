import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { ParkAlertOutput } from "../../../common/recover/park-alert.cell.ts"
import { EmitDealPaidOutput } from "../cells/emit-deal-paid.cell.ts"
import { EmitPayRequestedOutput } from "../cells/emit-pay-requested.cell.ts"
import { ReadDealOutput } from "../cells/read-deal.cell.ts"
import { SendPayOutput } from "../cells/send-pay.cell.ts"
import { UpdateDealOutput } from "../cells/update-deal.cell.ts"
import { Open } from "./steps/open.step.ts"
import { Read } from "./steps/read.step.ts"
import { WriteCode } from "./steps/write-code.step.ts"
import { SendPay } from "./steps/send-pay.step.ts"
import { SentOk } from "./steps/sent-ok.step.ts"
import { Watch1 } from "./steps/watch-1.step.ts"
import { Settle1 } from "./steps/settle-1.step.ts"
import { Paid1 } from "./steps/paid-1.step.ts"
import { Short1 } from "./steps/short-1.step.ts"
import { Nudge } from "./steps/nudge.step.ts"
import { Watch2 } from "./steps/watch-2.step.ts"
import { Settle2 } from "./steps/settle-2.step.ts"
import { Paid2 } from "./steps/paid-2.step.ts"
import { RecordPaid } from "./steps/record-paid.step.ts"
import { Announce } from "./steps/announce.step.ts"
import { Paid } from "./steps/paid.step.ts"
import { ParkSend } from "./steps/park-send.step.ts"
import { ParkShort } from "./steps/park-short.step.ts"
import { ParkUnpaid } from "./steps/park-unpaid.step.ts"
import { Declined } from "./steps/declined.step.ts"
import { Parked } from "./steps/parked.step.ts"

/** What a payment watch ends with, as the deal's run reads it from its `Ended` item. */
export const Result = z.strictObject({ reason: z.string(), paid: z.boolean(), amount: z.number(), transferId: z.string() })
export type Result = z.infer<typeof Result>

/** The one state object of a run: the deal written, what was read of it, the pay code written, the requests and the reminder, the watch result, the paid record and the alert. */
export const State = z.strictObject({
    change: z.strictObject({ objectId: z.string(), version: z.number().int() }).optional(),
    deal: ReadDealOutput.optional(),
    written: UpdateDealOutput.optional(),
    sent: SendPayOutput.optional(),
    watch1: EmitPayRequestedOutput.optional(),
    result: Result.optional(),
    nudged: SendPayOutput.optional(),
    watch2: EmitPayRequestedOutput.optional(),
    recorded: UpdateDealOutput.optional(),
    announced: EmitDealPaidOutput.optional(),
    alert: ParkAlertOutput.optional(),
})

/**
 * `nivo-gtm.deals-pay` (Thu tiền): the customer said yes (the deal is `accepted`). The deal gets its pay code `NIVO<code>`, the customer is sent the transfer details (a person approves the send, locked), and a
 * payment watch child (`nivo-gtm.deals-pay-watch`, on the order subject SePay names) waits for the transfer. No money in time: ONE reminder (approved the same way) and a second watch; still nothing, or a short transfer, parks
 * with ONE alert card. Paid: the deal is `paid` with the SePay transaction id, and `nivo-gtm.deal.paid` starts the activation.
 */
export class Pay implements Workflow<typeof State> {
    readonly key = keyOf("deals-pay")
    readonly version = 1
    readonly title = { vi: "Thu tiền", en: "Collect the payment" }
    readonly state = State
    readonly start = Open
    readonly steps = [Open, Read, WriteCode, SendPay, SentOk, Watch1, Settle1, Paid1, Short1, Nudge, Watch2, Settle2, Paid2, RecordPaid, Announce, Paid, ParkSend, ParkShort, ParkUnpaid, Declined, Parked]
}
