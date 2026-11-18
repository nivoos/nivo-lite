import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { EmitDemoDone } from "./emit-demo-done.step.ts"
import { EndNotHeld } from "./end-not-held.step.ts"

/** Branches on `recorded.status === "done"`: when it holds the run goes to `EmitDemoDone`, otherwise to `EndNotHeld`. */
export class IsDone extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.recorded.status === "done"
    override readonly yes = EmitDemoDone
    override readonly no = EndNotHeld
}
