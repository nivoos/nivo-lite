import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { SetLeadStage } from "./set-lead-stage.step.ts"
import { ParkFailed } from "./park-failed.step.ts"

export class Resume9 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.leadStaged.refusal !== undefined && s.leadStaged.refusal !== ""
    override readonly yes = SetLeadStage
    override readonly no = ParkFailed
}
