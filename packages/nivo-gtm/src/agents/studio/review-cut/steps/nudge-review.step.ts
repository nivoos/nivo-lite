import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { PostCard as PostCardCell } from "../../../../common/recover/post-card.cell.ts"
import { WaitReviewAgain } from "./wait-review-again.step.ts"
import type { State } from "../review-cut.workflow.ts"

export class NudgeReview extends NodeRun(PostCardCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ text: s.card.nudgeText, choices: s.card.choices })
    override readonly into = ["nudged"] as const
    override readonly next = WaitReviewAgain
}
