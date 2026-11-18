import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SendPay as SendPayCell } from "../../cells/send-pay.cell.ts"
import type { State } from "../pay.workflow.ts"
import { Watch } from "./watch.step.ts"

/** ONE reminder, approved by a person (locked ask); declining it, or a channel that refuses it, still opens the second watch. */
export class Nudge extends NodeRun(SendPayCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        channel: s.deal.channel,
        to: s.deal.chatRef,
        leadName: s.deal.leadName,
        payCode: s.deal.payCode,
        amount: s.deal.amount,
        kind: "nudge" as const,
    })
    override readonly into = ["nudged"] as const
    override readonly next = Watch
    override readonly onDeclined = Watch
    override readonly onRefused = { route_held: Watch, contact_erased: Watch }
}
