import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../signal.workflow.ts"
import { Opener } from "./opener.step.ts"
import { Resume3 } from "./resume3.step.ts"

export class Resume2 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.opener.refusal !== undefined && s.opener.refusal !== ""
    override readonly yes = Opener
    override readonly no = Resume3
}
