import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../pay.workflow.ts"
import { RecordPaid } from "./record-paid.step.ts"
import { Short1 } from "./short-1.step.ts"

export class Paid1 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.result.paid === true
    override readonly yes = RecordPaid
    override readonly no = Short1
}
