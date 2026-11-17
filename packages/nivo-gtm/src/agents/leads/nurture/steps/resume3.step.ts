import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../nurture.workflow.ts"
import { Count } from "./count.step.ts"
import { Resume4 } from "./resume4.step.ts"

export class Resume3 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.counted.refusal !== undefined && s.counted.refusal !== ""
    override readonly yes = Count
    override readonly no = Resume4
}
