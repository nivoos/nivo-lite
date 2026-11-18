import { NodeWait, take, type StateOf } from "@starci/nivoos-sdk"
import { IsApproved } from "./is-approved.step.ts"
import { NoReview } from "./no-review.step.ts"
import type { State, Answer } from "../calendar-round.workflow.ts"

/** Waits for the reviewer answer after the nudge, until the second review time; on timeout the run ends `no_review`. */
export class WaitWeekAgain extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(
            { engine: "engine.room.answered", version: 1 },
            { when: (items: Array<Answer>) => items.filter((item) => item.choice.startsWith("week-")) },
            (s, answers: Array<Answer>) => {
                answers.forEach((answer) => s.answers.push(answer))
            },
        ),
    ]
    override readonly timeout = (s: StateOf<typeof State>) => new Date(Date.parse(s.filed?.secondReviewBy ?? ""))
    override readonly next = IsApproved
    override readonly onTimeout = NoReview
}
