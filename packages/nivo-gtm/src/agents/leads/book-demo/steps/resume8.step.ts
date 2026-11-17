import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { RecordDemo } from "./record-demo.step.ts"
import { Resume9 } from "./resume9.step.ts"

export class Resume8 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.recorded.refusal !== undefined && s.recorded.refusal !== ""
    override readonly yes = RecordDemo
    override readonly no = Resume9
}
