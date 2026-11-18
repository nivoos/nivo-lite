import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { EmitDealPaid as EmitDealPaidCell } from "../../cells/emit-deal-paid.cell.ts"
import type { State } from "../pay.workflow.ts"
import { Paid } from "./paid.step.ts"

/** Announces the paid deal: the activation starts on it. */
export class Announce extends NodeRun(EmitDealPaidCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        dealId: s.deal.dealId,
        code: s.deal.code,
        amount: s.deal.amount,
    })
    override readonly into = ["announced"] as const
    override readonly next = Paid
}
