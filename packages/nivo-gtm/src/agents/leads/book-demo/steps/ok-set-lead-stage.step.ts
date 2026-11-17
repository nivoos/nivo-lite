import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { IsDone } from "./is-done.step.ts"
import { Retry } from "./retry.step.ts"

export class OkSetLeadStage extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.leadStaged.refusal === ""
    override readonly yes = IsDone
    override readonly no = Retry
}
