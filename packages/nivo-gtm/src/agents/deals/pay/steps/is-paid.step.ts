import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../pay.workflow.ts"
import { IsReminded } from "./is-reminded.step.ts"
import { RecordPaid } from "./record-paid.step.ts"

/** Branches on the watch result: a paid deal is recorded, otherwise the run decides whether to remind. */
export class IsPaid extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.result.paid === true
    override readonly yes = RecordPaid
    override readonly no = IsReminded
}
