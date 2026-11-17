import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { NoteInvite } from "./note-invite.step.ts"
import { Resume3 } from "./resume3.step.ts"

export class Resume2 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.touched.refusal !== undefined && s.touched.refusal !== ""
    override readonly yes = NoteInvite
    override readonly no = Resume3
}
