import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SetPlan as SetPlanCell } from "../../cells/set-plan.cell.ts"
import type { State } from "../handover.workflow.ts"
import { Handed } from "./handed.step.ts"

/** Writes the plan: the quote workflow starts on it. */
export class SetPlan extends NodeRun(SetPlanCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ dealId: s.deal.dealId })
    override readonly into = ["plan"] as const
    override readonly next = Handed
}
