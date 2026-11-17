import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SendQuote as SendQuoteCell } from "../../cells/send-quote.cell.ts"
import type { State } from "../quote.workflow.ts"
import { SentOk } from "./sent-ok.step.ts"
import { Declined } from "./declined.step.ts"

/** Leaves the company: a person approves it (locked ask). */
export class SendQuote extends NodeRun(SendQuoteCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ channel: s.deal.channel, to: s.deal.chatRef, leadName: s.deal.leadName, code: s.deal.code, lines: s.price.lines, trialDays: s.price.trialDays })
    override readonly into = ["sent"] as const
    override readonly next = SentOk
    override readonly onDeclined = Declined
}
