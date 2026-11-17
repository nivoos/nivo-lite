import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../nurture.workflow.ts"
import { SendFollowUp } from "./send-follow-up.step.ts"
import { Resume3 } from "./resume3.step.ts"

export class Resume2 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.sent.refusal !== undefined && s.sent.refusal !== ""
    override readonly yes = SendFollowUp
    override readonly no = Resume3
}
