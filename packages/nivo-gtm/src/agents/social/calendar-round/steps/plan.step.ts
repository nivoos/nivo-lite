import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialPlan as PlanCell } from "../plan.cell.ts"
import { FileSlots } from "./file-slots.step.ts"
import type { State } from "../calendar-round.workflow.ts"

/** Asks the model to place the approved content on channels, days and hours. */
export class Plan extends NodeRun(PlanCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        instant: s.read.instant,
        items: s.read.items,
        metrics: s.read.metrics,
    })
    override readonly into = ["plan"] as const
    override readonly next = FileSlots
}
