import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioReviewCard as ReviewCardCell } from "../review-card.cell.ts"
import { AskReview } from "./ask-review.step.ts"
import type { State } from "../review-cut.workflow.ts"

export class ReviewCard extends NodeRun(ReviewCardCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ cut: s.ctx, check: s.check })
    override readonly into = ["card"] as const
    override readonly next = AskReview
}
