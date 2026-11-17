import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { NoteBooked } from "./note-booked.step.ts"
import { Resume7 } from "./resume7.step.ts"

export class Resume6 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.staged.refusal !== undefined && s.staged.refusal !== ""
    override readonly yes = NoteBooked
    override readonly no = Resume7
}
