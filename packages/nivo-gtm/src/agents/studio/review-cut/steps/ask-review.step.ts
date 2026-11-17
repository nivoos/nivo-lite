import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioAskTeam as AskTeamCell } from "../../common/ask-team.cell.ts"
import { WaitReview } from "./wait-review.step.ts"
import type { State } from "../review-cut.workflow.ts"

export class AskReview extends NodeRun(AskTeamCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ text: s.card.cardText, choices: s.card.choices })
    override readonly into = ["asked"] as const
    override readonly next = WaitReview
}
