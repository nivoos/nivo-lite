import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../calendar-round.workflow.ts"

/** Nobody answered the week's card, even after the nudge: the plan stays as filed. */
export class NoReview extends NodeEnd<typeof State> {
    override readonly reason = "no_review"
}
