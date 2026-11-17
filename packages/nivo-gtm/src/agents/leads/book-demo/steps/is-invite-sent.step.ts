import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { NoteInvite } from "./note-invite.step.ts"
import { EndDeclined } from "./end-declined.step.ts"

export class IsInviteSent extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.sent.sent === true
    override readonly yes = NoteInvite
    override readonly no = EndDeclined
}
