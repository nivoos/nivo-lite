import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { EndInvited } from "./end-invited.step.ts"
import { Retry } from "./retry.step.ts"

export class OkNoteInvite extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.touched.refusal === ""
    override readonly yes = EndInvited
    override readonly no = Retry
}
