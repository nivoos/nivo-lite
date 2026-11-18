import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioAskTeam as AskTeamCell } from "../../common/ask-team.cell.ts"
import { WaitReviewAgain } from "./wait-review-again.step.ts"
import type { State } from "../review-cut.workflow.ts"

/** Nudges the team once that the cut still waits for a review. */
export class NudgeReview extends NodeRun(AskTeamCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ text: s.card.nudgeText, choices: s.card.choices })
    override readonly into = ["nudged"] as const
    override readonly next = WaitReviewAgain
}
