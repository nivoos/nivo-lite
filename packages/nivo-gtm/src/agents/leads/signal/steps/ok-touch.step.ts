import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../signal.workflow.ts"
import { EndOpened } from "./end-opened.step.ts"
import { Retry } from "./retry.step.ts"

export class OkTouch extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.touched.refusal === ""
    override readonly yes = EndOpened
    override readonly no = Retry
}
