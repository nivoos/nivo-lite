import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { SetLeadStage } from "./set-lead-stage.step.ts"
import { Retry } from "./retry.step.ts"

export class OkRecordDemo extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.recorded.refusal === ""
    override readonly yes = SetLeadStage
    override readonly no = Retry
}
