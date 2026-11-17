import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SendPay as SendPayCell } from "../../cells/send-pay.cell.ts"
import type { State } from "../pay.workflow.ts"
import { SentOk } from "./sent-ok.step.ts"
import { Declined } from "./declined.step.ts"

/** Leaves the company: a person approves it (locked ask). */
export class SendPay extends NodeRun(SendPayCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ channel: s.deal.channel, to: s.deal.chatRef, leadName: s.deal.leadName, payCode: s.deal.payCode, amount: s.deal.amount, kind: "request" as const })
    override readonly into = ["sent"] as const
    override readonly next = SentOk
    override readonly onDeclined = Declined
}
