import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../front.workflow.ts"
import { Understand } from "./understand.step.ts"
import { Retry } from "./retry.step.ts"

export class OkOpenLead extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.lead.refusal === ""
    override readonly yes = Understand
    override readonly no = Retry
}
