import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../qualify.workflow.ts"
import { Save } from "./save.step.ts"
import { ParkFailed } from "./park-failed.step.ts"

export class Resume2 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.saved.refusal !== undefined && s.saved.refusal !== ""
    override readonly yes = Save
    override readonly no = ParkFailed
}
