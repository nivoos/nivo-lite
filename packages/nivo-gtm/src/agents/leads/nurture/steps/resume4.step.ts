import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../nurture.workflow.ts"
import { GoCold } from "./go-cold.step.ts"
import { ParkFailed } from "./park-failed.step.ts"

export class Resume4 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.cooled.refusal !== undefined && s.cooled.refusal !== ""
    override readonly yes = GoCold
    override readonly no = ParkFailed
}
