import { NodeWait, take, type StateOf } from "@starci/nivoos-sdk"
import { IsApproved } from "./is-approved.step.ts"
import { NoReview } from "./no-review.step.ts"
import type { State, Answer } from "../post-draft.workflow.ts"

export class WaitReviewAgain extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(
            { engine: "engine.room.answered", version: 1 },
            { when: (items: Answer[]) => items.filter((item) => item.choice.startsWith("post-")) },
            (s, answers: Answer[]) => { answers.forEach((answer) => s.answers.push(answer)) },
        ),
    ]
    override readonly timeout = (s: StateOf<typeof State>) => new Date(Date.parse(s.saved?.secondReviewBy ?? ""))
    override readonly next = IsApproved
    override readonly onTimeout = NoReview
}
