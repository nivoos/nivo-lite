import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SaveScore as SaveScoreCell } from "../save-score.cell.ts"
import type { State } from "../qualify.workflow.ts"
import { IsQualified } from "./is-qualified.step.ts"

export class Save extends NodeRun(SaveScoreCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ leadId: s.readies[0].leadId, score: s.score.score, segment: s.score.segment, reasons: s.score.reasons })
    override readonly into = ["saved"] as const
    override readonly next = IsQualified
}
