import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { EmitLeadReady as EmitLeadReadyCell } from "../../common/emit-lead-ready.cell.ts"
import type { State } from "../front.workflow.ts"
import { EndReady } from "./end-ready.step.ts"

export class EmitReady extends NodeRun(EmitLeadReadyCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ leadId: s.lead.leadId, code: s.lead.code, reason: s.readiness.reason, turns: s.touched.turns })
    override readonly into = ["emitted"] as const
    override readonly next = EndReady
}
