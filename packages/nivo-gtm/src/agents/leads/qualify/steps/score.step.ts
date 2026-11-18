import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { Score as ScoreCell } from "../score.cell.ts"
import type { State } from "../qualify.workflow.ts"
import { Save } from "./save.step.ts"

/** Runs `Score` (how many brain hits the scoring reads (the ideal-customer rubric)) and keeps its result in `score`; the run then goes to `Save`. */
export class Score extends NodeRun(ScoreCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ leadId: s.readies[0].leadId })
    override readonly into = ["score"] as const
    override readonly next = Save
}
