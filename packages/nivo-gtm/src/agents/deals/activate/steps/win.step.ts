import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { UpdateLead as UpdateLeadCell } from "../../cells/update-lead.cell.ts"
import type { State } from "../activate.workflow.ts"
import { Welcome } from "./welcome.step.ts"

/** Moves the lead to `won` once the deal is activated, so the sales funnel stops chasing a paying customer. */
export class Win extends NodeRun(UpdateLeadCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        leadId: s.deal.leadId,
        stage: "won" as const,
        nextAction: "Chăm sóc khách mới",
        evidence: s.deal.code,
    })
    override readonly into = ["won"] as const
    override readonly next = Welcome
}
