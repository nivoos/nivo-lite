import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../signal.workflow.ts"
import { SendOpener } from "./send-opener.step.ts"
import { Resume4 } from "./resume4.step.ts"

export class Resume3 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.sent.refusal !== undefined && s.sent.refusal !== ""
    override readonly yes = SendOpener
    override readonly no = Resume4
}
