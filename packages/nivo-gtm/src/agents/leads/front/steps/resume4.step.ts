import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../front.workflow.ts"
import { Answer } from "./answer.step.ts"
import { Resume5 } from "./resume5.step.ts"

export class Resume4 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.answer.refusal !== undefined && s.answer.refusal !== ""
    override readonly yes = Answer
    override readonly no = Resume5
}
