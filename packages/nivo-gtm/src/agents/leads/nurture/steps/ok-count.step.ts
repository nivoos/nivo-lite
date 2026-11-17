import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../nurture.workflow.ts"
import { Wait } from "./wait.step.ts"
import { Retry } from "./retry.step.ts"

export class OkCount extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.counted.refusal === ""
    override readonly yes = Wait
    override readonly no = Retry
}
