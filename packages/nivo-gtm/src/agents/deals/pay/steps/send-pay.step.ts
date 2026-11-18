import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SendPay as SendPayCell } from "../../cells/send-pay.cell.ts"
import type { State } from "../pay.workflow.ts"
import { Watch } from "./watch.step.ts"
import { Declined } from "./declined.step.ts"
import { Unreachable } from "./unreachable.step.ts"

/** Leaves the company: a person approves it (locked ask). A held route or an erased contact ends the run `unreachable`. */
export class SendPay extends NodeRun(SendPayCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        channel: s.deal.channel,
        to: s.deal.chatRef,
        leadName: s.deal.leadName,
        payCode: s.deal.payCode,
        amount: s.deal.amount,
        kind: "request" as const,
    })
    override readonly into = ["sent"] as const
    override readonly next = Watch
    override readonly onDeclined = Declined
    override readonly onRefused = { route_held: Unreachable, contact_erased: Unreachable }
}
