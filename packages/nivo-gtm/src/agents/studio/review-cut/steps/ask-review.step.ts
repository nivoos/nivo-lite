import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { PostCard as PostCardCell } from "../../../../common/recover/post-card.cell.ts"
import { WaitReview } from "./wait-review.step.ts"
import type { State } from "../review-cut.workflow.ts"

export class AskReview extends NodeRun(PostCardCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ text: s.card.cardText, choices: s.card.choices })
    override readonly into = ["asked"] as const
    override readonly next = WaitReview
}
