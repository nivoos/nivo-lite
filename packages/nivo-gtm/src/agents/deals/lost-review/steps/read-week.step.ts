import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { LostWeek as LostWeekCell } from "../../cells/lost-week.cell.ts"
import type { State } from "../lost-review.workflow.ts"
import { Summarize } from "./summarize.step.ts"

/** Reads the lost deals and the cold or lost leads of the week. */
export class ReadWeek extends NodeRun(LostWeekCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ day: s.instant })
    override readonly into = ["week"] as const
    override readonly next = Summarize
}
