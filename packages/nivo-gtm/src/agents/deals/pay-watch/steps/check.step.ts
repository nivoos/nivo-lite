import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { CheckAmount as CheckAmountCell } from "../../cells/check-amount.cell.ts"
import type { State } from "../pay-watch.workflow.ts"
import { ShortCheck } from "./short-check.step.ts"

export class Check extends NodeRun(CheckAmountCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ expected: s.request.amount, paid: s.payment.amount })
    override readonly into = ["check"] as const
    override readonly next = ShortCheck
}
