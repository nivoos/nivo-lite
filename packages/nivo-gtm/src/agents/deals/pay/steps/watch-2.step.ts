import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { EmitPayRequested as EmitPayRequestedCell } from "../../cells/emit-pay-requested.cell.ts"
import type { State } from "../pay.workflow.ts"
import { Settle2 } from "./settle-2.step.ts"

export class Watch2 extends NodeRun(EmitPayRequestedCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ dealId: s.deal.dealId, payCode: s.deal.payCode, amount: s.deal.amount, round: 2 })
    override readonly into = ["watch2"] as const
    override readonly next = Settle2
}
