import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../signal.workflow.ts"
import { OpenLead } from "./open-lead.step.ts"
import { Resume2 } from "./resume2.step.ts"

export class Resume1 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.lead.refusal !== undefined && s.lead.refusal !== ""
    override readonly yes = OpenLead
    override readonly no = Resume2
}
