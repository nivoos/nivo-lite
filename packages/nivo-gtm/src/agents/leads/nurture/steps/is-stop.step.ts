import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../nurture.workflow.ts"
import { EndStopped } from "./end-stopped.step.ts"
import { IsCold } from "./is-cold.step.ts"

export class IsStop extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.check.action === "stop"
    override readonly yes = EndStopped
    override readonly no = IsCold
}
