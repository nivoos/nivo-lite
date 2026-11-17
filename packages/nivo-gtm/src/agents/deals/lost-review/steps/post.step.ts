import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { PostReview as PostReviewCell } from "../../cells/post-review.cell.ts"
import type { State } from "../lost-review.workflow.ts"
import { Reviewed } from "./reviewed.step.ts"

export class Post extends NodeRun(PostReviewCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ text: s.summary.text })
    override readonly into = ["posted"] as const
    override readonly next = Reviewed
}
