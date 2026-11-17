import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../script.workflow.ts"

/** Nobody answered the review card or the nudge: the script stays in `script_review` for a person to pick up. */
export class NoReview extends NodeEnd<typeof State> {
    override readonly reason = "no_review"
}
