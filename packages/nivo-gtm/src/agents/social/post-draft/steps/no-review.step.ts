import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../post-draft.workflow.ts"

/** Nobody answered the review card, even after the nudge. */
export class NoReview extends NodeEnd<typeof State> {
    override readonly reason = "no_review"
}
