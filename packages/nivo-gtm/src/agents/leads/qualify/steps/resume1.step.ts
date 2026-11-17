import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../qualify.workflow.ts"
import { Score } from "./score.step.ts"
import { Resume2 } from "./resume2.step.ts"

export class Resume1 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.score.refusal !== undefined && s.score.refusal !== ""
    override readonly yes = Score
    override readonly no = Resume2
}
