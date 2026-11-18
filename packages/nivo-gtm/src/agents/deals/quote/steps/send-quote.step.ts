import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SendQuote as SendQuoteCell } from "../../cells/send-quote.cell.ts"
import type { State } from "../quote.workflow.ts"
import { Record } from "./record.step.ts"
import { Declined } from "./declined.step.ts"
import { Unreachable } from "./unreachable.step.ts"

/** Leaves the company: a person approves it (locked ask). A held route or an erased contact ends the run `unreachable`. */
export class SendQuote extends NodeRun(SendQuoteCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        channel: s.deal.channel,
        to: s.deal.chatRef,
        leadName: s.deal.leadName,
        code: s.deal.code,
        lines: s.price.lines,
        trialDays: s.price.trialDays,
    })
    override readonly into = ["sent"] as const
    override readonly next = Record
    override readonly onDeclined = Declined
    override readonly onRefused = { route_held: Unreachable, contact_erased: Unreachable }
}
