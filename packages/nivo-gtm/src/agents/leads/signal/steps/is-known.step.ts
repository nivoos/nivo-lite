import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../signal.workflow.ts"
import { IsReachable } from "./is-reachable.step.ts"
import { OpenLead } from "./open-lead.step.ts"

export class IsKnown extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.lead.found === true
    override readonly yes = IsReachable
    override readonly no = OpenLead
}
