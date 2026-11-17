import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { PickSlot } from "./pick-slot.step.ts"
import { Resume4 } from "./resume4.step.ts"

export class Resume3 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.pick.refusal !== undefined && s.pick.refusal !== ""
    override readonly yes = PickSlot
    override readonly no = Resume4
}
