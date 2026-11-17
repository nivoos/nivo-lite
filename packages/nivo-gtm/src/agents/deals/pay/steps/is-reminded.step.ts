import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../pay.workflow.ts"
import { IsShort } from "./is-short.step.ts"
import { UnpaidNotice } from "./unpaid-notice.step.ts"

/** This was the second watch: the one reminder was spent. */
export class IsReminded extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.watched.round >= 2
    override readonly yes = UnpaidNotice
    override readonly no = IsShort
}
