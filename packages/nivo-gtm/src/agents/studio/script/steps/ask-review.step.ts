import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { PostCard as PostCardCell } from "../../../../common/recover/post-card.cell.ts"
import { WaitReview } from "./wait-review.step.ts"
import type { State } from "../script.workflow.ts"

export class AskReview extends NodeRun(PostCardCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ text: s.saved.cardText, choices: s.saved.choices })
    override readonly into = ["asked"] as const
    override readonly next = WaitReview
}
