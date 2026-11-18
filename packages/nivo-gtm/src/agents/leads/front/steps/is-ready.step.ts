import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../front.workflow.ts"
import { EmitReady } from "./emit-ready.step.ts"
import { EndAnswered } from "./end-answered.step.ts"

/** Branches on `readiness.ready === true`: when it holds the run goes to `EmitReady`, otherwise to `EndAnswered`. */
export class IsReady extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.readiness.ready === true
    override readonly yes = EmitReady
    override readonly no = EndAnswered
}
