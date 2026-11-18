import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SendWelcome as SendWelcomeCell } from "../../cells/send-welcome.cell.ts"
import type { State } from "../activate.workflow.ts"
import { Closed } from "./closed.step.ts"
import { Unreachable } from "./unreachable.step.ts"

/** Leaves the company: a person approves it (locked ask). A held route or an erased contact ends the run `unreachable`. */
export class Welcome extends NodeRun(SendWelcomeCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        channel: s.deal.channel,
        to: s.deal.chatRef,
        leadName: s.deal.leadName,
        plan: s.deal.plan,
    })
    override readonly into = ["sent"] as const
    override readonly next = Closed
    override readonly onDeclined = Closed
    override readonly onRefused = { route_held: Unreachable, contact_erased: Unreachable }
}
