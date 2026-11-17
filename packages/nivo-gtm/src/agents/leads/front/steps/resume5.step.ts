import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../front.workflow.ts"
import { SendAnswer } from "./send-answer.step.ts"
import { ParkFailed } from "./park-failed.step.ts"

export class Resume5 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.sent.refusal !== undefined && s.sent.refusal !== ""
    override readonly yes = SendAnswer
    override readonly no = ParkFailed
}
