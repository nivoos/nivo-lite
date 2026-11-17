import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { EmitPayRequested as EmitPayRequestedCell } from "../../cells/emit-pay-requested.cell.ts"
import type { State } from "../pay.workflow.ts"
import { Settle } from "./settle.step.ts"

/** Opens the payment watch as a child: round 1 the first time, round 2 after the one reminder (the round is read from the watch that ran before). */
export class Watch extends NodeRun(EmitPayRequestedCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ dealId: s.deal.dealId, payCode: s.deal.payCode, amount: s.deal.amount, round: s.watched === undefined ? 1 : s.watched.round + 1 })
    override readonly into = ["watched"] as const
    override readonly next = Settle
}
