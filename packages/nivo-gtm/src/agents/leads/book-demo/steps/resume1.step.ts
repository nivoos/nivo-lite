import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { SendInvite } from "./send-invite.step.ts"
import { Resume2 } from "./resume2.step.ts"

export class Resume1 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.sent.refusal !== undefined && s.sent.refusal !== ""
    override readonly yes = SendInvite
    override readonly no = Resume2
}
