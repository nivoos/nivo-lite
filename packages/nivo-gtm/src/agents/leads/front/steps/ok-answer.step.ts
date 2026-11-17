import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../front.workflow.ts"
import { HasAnswer } from "./has-answer.step.ts"
import { Retry } from "./retry.step.ts"

export class OkAnswer extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.answer.refusal === ""
    override readonly yes = HasAnswer
    override readonly no = Retry
}
