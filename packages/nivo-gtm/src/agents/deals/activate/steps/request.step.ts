import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { RequestActivation as RequestActivationCell } from "../../cells/request-activation.cell.ts"
import type { State } from "../activate.workflow.ts"
import { Activated } from "./activated.step.ts"

export class Request extends NodeRun(RequestActivationCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ code: s.deal.code, leadName: s.deal.leadName, plan: s.deal.plan, months: s.deal.months, amount: s.deal.amount })
    override readonly into = ["asked"] as const
    override readonly next = Activated
}
