import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { UpdateDeal as UpdateDealCell } from "../../cells/update-deal.cell.ts"
import type { State } from "../activate.workflow.ts"
import { Win } from "./win.step.ts"

export class Record extends NodeRun(UpdateDealCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ dealId: s.deal.dealId, status: "activated" as const, nextAction: "Chăm sóc khách mới", due: "care" as const, evidence: s.answer.memberId, stamp: "activated" as const })
    override readonly into = ["recorded"] as const
    override readonly next = Win
}
