import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../front.workflow.ts"
import { Understand } from "./understand.step.ts"
import { OpenLead } from "./open-lead.step.ts"

/** Branches on `lead.found === true`: when it holds the run goes to `Understand`, otherwise to `OpenLead`. */
export class IsKnown extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.lead.found === true
    override readonly yes = Understand
    override readonly no = OpenLead
}
