import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SaveScore as SaveScoreCell } from "../save-score.cell.ts"
import type { State } from "../qualify.workflow.ts"
import { IsQualified } from "./is-qualified.step.ts"

/** Runs `SaveScore` (the business rules: the score from which a lead is qualified, and the score under which a lead that has barely started is dropped as unfit) and keeps its result in `saved`; the run then goes to `IsQualified`. */
export class Save extends NodeRun(SaveScoreCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        leadId: s.readies[0].leadId,
        score: s.score.score,
        segment: s.score.segment,
        reasons: s.score.reasons,
    })
    override readonly into = ["saved"] as const
    override readonly next = IsQualified
}
