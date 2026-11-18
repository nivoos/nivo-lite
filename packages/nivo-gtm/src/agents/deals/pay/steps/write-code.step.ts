import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { UpdateDeal as UpdateDealCell } from "../../cells/update-deal.cell.ts"
import type { State } from "../pay.workflow.ts"
import { SendPay } from "./send-pay.step.ts"

/** Writes the pay code on the deal and moves it to awaiting payment, so the bank transfer memo can be matched to it. */
export class WriteCode extends NodeRun(UpdateDealCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        dealId: s.deal.dealId,
        status: "awaiting_payment" as const,
        payCode: s.deal.payCode,
        nextAction: "Chờ khách chuyển khoản",
        due: "payment" as const,
        stamp: "none" as const,
    })
    override readonly into = ["written"] as const
    override readonly next = SendPay
}
