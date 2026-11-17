import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { EmitPayRequested as EmitPayRequestedCell } from "../../cells/emit-pay-requested.cell.ts"
import type { State } from "../pay.workflow.ts"
import { Settle1 } from "./settle-1.step.ts"

/** Opens the payment watch as a child. */
export class Watch1 extends NodeRun(EmitPayRequestedCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ dealId: s.deal.dealId, payCode: s.deal.payCode, amount: s.deal.amount, round: 1 })
    override readonly into = ["watch1"] as const
    override readonly next = Settle1
}
