import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../pay.workflow.ts"
import { ParkShort } from "./park-short.step.ts"
import { Nudge } from "./nudge.step.ts"

export class Short1 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.result.reason === "short"
    override readonly yes = ParkShort
    override readonly no = Nudge
}
