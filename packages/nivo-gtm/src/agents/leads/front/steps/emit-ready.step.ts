import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { EmitLeadReady as EmitLeadReadyCell } from "../../common/emit-lead-ready.cell.ts"
import type { State } from "../front.workflow.ts"
import { EndReady } from "./end-ready.step.ts"

/** Runs `EmitLeadReady` (says the lead is ready to be scored: one act, `events.emit` of `LeadReady` on the subject `lead:<code>`) and keeps its result in `emitted`; the run then goes to `EndReady`. */
export class EmitReady extends NodeRun(EmitLeadReadyCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        leadId: s.lead.leadId,
        code: s.lead.code,
        reason: s.readiness.reason,
        turns: s.touched.turns,
    })
    override readonly into = ["emitted"] as const
    override readonly next = EndReady
}
