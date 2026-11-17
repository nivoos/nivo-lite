import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../pay.workflow.ts"
import { ShortNotice } from "./short-notice.step.ts"
import { Nudge } from "./nudge.step.ts"

export class Short1 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.result.reason === "short"
    override readonly yes = ShortNotice
    override readonly no = Nudge
}
