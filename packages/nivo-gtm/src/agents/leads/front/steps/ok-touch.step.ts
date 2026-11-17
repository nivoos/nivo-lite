import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../front.workflow.ts"
import { IsSlot } from "./is-slot.step.ts"
import { Retry } from "./retry.step.ts"

export class OkTouch extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.touched.refusal === ""
    override readonly yes = IsSlot
    override readonly no = Retry
}
