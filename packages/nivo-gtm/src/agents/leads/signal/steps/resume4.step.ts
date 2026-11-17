import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../signal.workflow.ts"
import { Touch } from "./touch.step.ts"
import { ParkFailed } from "./park-failed.step.ts"

export class Resume4 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.touched.refusal !== undefined && s.touched.refusal !== ""
    override readonly yes = Touch
    override readonly no = ParkFailed
}
