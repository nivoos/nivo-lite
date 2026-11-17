import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../front.workflow.ts"
import { Touch } from "./touch.step.ts"
import { Resume4 } from "./resume4.step.ts"

export class Resume3 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.touched.refusal !== undefined && s.touched.refusal !== ""
    override readonly yes = Touch
    override readonly no = Resume4
}
