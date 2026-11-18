import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { Brief as BriefCell } from "../../cells/brief.cell.ts"
import type { State } from "../handover.workflow.ts"
import { OpenDeal } from "./open-deal.step.ts"

/** Reads the lead and the demo into a short handover brief: who the customer is, what worries them and which plan to offer. */
export class Brief extends NodeRun(BriefCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        leadId: s.event.leadId,
        demoId: s.event.demoId,
        note: s.event.note,
    })
    override readonly into = ["brief"] as const
    override readonly next = OpenDeal
}
