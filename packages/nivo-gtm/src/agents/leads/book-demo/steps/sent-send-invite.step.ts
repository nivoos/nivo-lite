import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { NoteInvite } from "./note-invite.step.ts"
import { HeldSendInvite } from "./held-send-invite.step.ts"

export class SentSendInvite extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.sent.sent === true
    override readonly yes = NoteInvite
    override readonly no = HeldSendInvite
}
