import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { UpdateDeal as UpdateDealCell } from "../../cells/update-deal.cell.ts"
import type { State } from "../pay.workflow.ts"
import { Announce } from "./announce.step.ts"

/** Marks the deal `paid` with the bank transfer id as proof and activation as the next action. */
export class RecordPaid extends NodeRun(UpdateDealCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        dealId: s.deal.dealId,
        status: "paid" as const,
        sepayRef: s.result.transferId,
        nextAction: "Kích hoạt gói cho khách",
        due: "activation" as const,
        evidence: s.result.transferId,
        stamp: "paid" as const,
    })
    override readonly into = ["recorded"] as const
    override readonly next = Announce
}
