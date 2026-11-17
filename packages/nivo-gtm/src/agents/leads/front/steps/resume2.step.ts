import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../front.workflow.ts"
import { Understand } from "./understand.step.ts"
import { Resume3 } from "./resume3.step.ts"

export class Resume2 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.understood.refusal !== undefined && s.understood.refusal !== ""
    override readonly yes = Understand
    override readonly no = Resume3
}
