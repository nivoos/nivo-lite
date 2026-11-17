import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { WaitRemind } from "./wait-remind.step.ts"
import { Retry } from "./retry.step.ts"

export class OkNoteBooked extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.staged.refusal === ""
    override readonly yes = WaitRemind
    override readonly no = Retry
}
