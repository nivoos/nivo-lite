import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialAskTeam as AskTeamCell } from "../../common/ask-team.cell.ts"
import { WaitReviewAgain } from "./wait-review-again.step.ts"
import type { State } from "../post-draft.workflow.ts"

export class NudgeReview extends NodeRun(AskTeamCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ text: s.saved.nudgeText })
    override readonly into = ["nudged"] as const
    override readonly next = WaitReviewAgain
}
