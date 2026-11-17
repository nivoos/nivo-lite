import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { UpdateDeal as UpdateDealCell } from "../../cells/update-deal.cell.ts"
import type { State } from "../pay.workflow.ts"
import { Announce } from "./announce.step.ts"

export class RecordPaid extends NodeRun(UpdateDealCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ dealId: s.deal.dealId, status: "paid" as const, sepayRef: s.result.transferId, nextAction: "Kích hoạt gói cho khách", nextInHours: 24, evidence: s.result.transferId, stamp: "paid" as const })
    override readonly into = ["recorded"] as const
    override readonly next = Announce
}
