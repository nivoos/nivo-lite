import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SendInvite as SendInviteCell } from "../send-invite.cell.ts"
import type { State } from "../book-demo.workflow.ts"
import { NoteInvite } from "./note-invite.step.ts"
import { EndDeclined } from "./end-declined.step.ts"

/** The invitation leaves the company: a person approves it first (`ask`, locked by the engine). A held route or an erased contact ends the run `declined`. */
export class SendInvite extends NodeRun(SendInviteCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ to: s.slots.code, name: s.slots.name, labels: s.slots.labels })
    override readonly into = ["sent"] as const
    override readonly next = NoteInvite
    override readonly onDeclined = EndDeclined
    override readonly onRefused = { route_held: EndDeclined, contact_erased: EndDeclined }
}
