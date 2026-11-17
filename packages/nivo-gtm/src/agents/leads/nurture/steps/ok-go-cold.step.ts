import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../nurture.workflow.ts"
import { EndCold } from "./end-cold.step.ts"
import { Retry } from "./retry.step.ts"

export class OkGoCold extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.cooled.refusal === ""
    override readonly yes = EndCold
    override readonly no = Retry
}
