import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SendInvite as SendInviteCell } from "../send-invite.cell.ts"
import type { State } from "../book-demo.workflow.ts"
import { IsInviteSent } from "./is-invite-sent.step.ts"
import { EndDeclined } from "./end-declined.step.ts"

/** The invitation leaves the company: a person approves it first (`ask`, locked by the engine). */
export class SendInvite extends NodeRun(SendInviteCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ to: s.slots.code, name: s.slots.name, labels: s.slots.labels })
    override readonly into = ["sent"] as const
    override readonly next = IsInviteSent
    override readonly onDeclined = EndDeclined
}
