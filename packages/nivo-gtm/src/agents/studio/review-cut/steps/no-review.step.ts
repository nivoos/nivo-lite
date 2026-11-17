import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../review-cut.workflow.ts"

/** Nobody reviewed the cut after the card and the nudge: the item stays as it is for a person to pick up. */
export class NoReview extends NodeEnd<typeof State> {
    override readonly reason = "no_review"
}
