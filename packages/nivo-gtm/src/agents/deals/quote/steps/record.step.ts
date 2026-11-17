import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { UpdateDeal as UpdateDealCell } from "../../cells/update-deal.cell.ts"
import type { State } from "../quote.workflow.ts"
import { Quoted } from "./quoted.step.ts"

export class Record extends NodeRun(UpdateDealCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ dealId: s.deal.dealId, status: "quoted" as const, amount: s.price.amount, discountPercent: s.price.discountPercent, nextAction: "Chờ khách đồng ý, hỏi lại sau 2 ngày", due: "quote_follow_up" as const, evidence: s.price.lines, stamp: "none" as const })
    override readonly into = ["recorded"] as const
    override readonly next = Quoted
}
