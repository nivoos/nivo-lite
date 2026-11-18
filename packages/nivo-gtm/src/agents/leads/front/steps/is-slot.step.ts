import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../front.workflow.ts"
import { EmitSlot } from "./emit-slot.step.ts"
import { IsSupport } from "./is-support.step.ts"

/** Branches on `understood.intent === "picks_slot"`: when it holds the run goes to `EmitSlot`, otherwise to `IsSupport`. */
export class IsSlot extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.understood.intent === "picks_slot"
    override readonly yes = EmitSlot
    override readonly no = IsSupport
}
