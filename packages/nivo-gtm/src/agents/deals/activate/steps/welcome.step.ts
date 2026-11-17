import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SendWelcome as SendWelcomeCell } from "../../cells/send-welcome.cell.ts"
import type { State } from "../activate.workflow.ts"
import { SentOk } from "./sent-ok.step.ts"
import { Closed } from "./closed.step.ts"

/** Leaves the company: a person approves it (locked ask). */
export class Welcome extends NodeRun(SendWelcomeCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ channel: s.deal.channel, to: s.deal.chatRef, leadName: s.deal.leadName, plan: s.deal.plan })
    override readonly into = ["sent"] as const
    override readonly next = SentOk
    override readonly onDeclined = Closed
}
