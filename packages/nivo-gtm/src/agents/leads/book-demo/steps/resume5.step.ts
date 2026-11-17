import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { SendConfirm } from "./send-confirm.step.ts"
import { Resume6 } from "./resume6.step.ts"

export class Resume5 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.confirmed.refusal !== undefined && s.confirmed.refusal !== ""
    override readonly yes = SendConfirm
    override readonly no = Resume6
}
