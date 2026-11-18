import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { TouchLead as TouchLeadCell } from "../../common/touch-lead.cell.ts"
import type { State } from "../front.workflow.ts"
import { IsSlot } from "./is-slot.step.ts"

/** Runs `TouchLead` (one line for the lead's notes: what happened in this touch) and keeps its result in `touched`; the run then goes to `IsSlot`. */
export class Touch extends NodeRun(TouchLeadCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        leadId: s.lead.leadId,
        note: s.understood.summary,
        nextAction: "",
        engage: true,
    })
    override readonly into = ["touched"] as const
    override readonly next = IsSlot
}
