import { NodeWait, take, type StateOf } from "@starci/nivoos-sdk"
import { IsApproved } from "./is-approved.step.ts"
import { NoReview } from "./no-review.step.ts"
import type { State, Answer } from "../review-cut.workflow.ts"

/** Waits for a review answer after the nudge, until the second deadline; no answer ends the run with the cut left for a person. */
export class WaitReviewAgain extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(
            { engine: "engine.room.answered", version: 1 },
            { when: (items: Array<Answer>) => items.filter((item) => item.choice.startsWith("cut-")) },
            (s, answers: Array<Answer>) => {
                answers.forEach((answer) => s.answers.push(answer))
            },
        ),
    ]
    override readonly timeout = (s: StateOf<typeof State>) => new Date(Date.parse(s.card?.secondReviewBy ?? ""))
    override readonly next = IsApproved
    override readonly onTimeout = NoReview
}
