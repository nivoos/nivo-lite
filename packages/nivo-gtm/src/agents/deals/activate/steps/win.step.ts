import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { UpdateLead as UpdateLeadCell } from "../../cells/update-lead.cell.ts"
import type { State } from "../activate.workflow.ts"
import { Welcome } from "./welcome.step.ts"

export class Win extends NodeRun(UpdateLeadCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ leadId: s.deal.leadId, stage: "won" as const, nextAction: "Chăm sóc khách mới", evidence: s.deal.code })
    override readonly into = ["won"] as const
    override readonly next = Welcome
}
