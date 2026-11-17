import { NodeWait, take, type StateOf } from "@starci/nivoos-sdk"
import { IsApproved } from "./is-approved.step.ts"
import { MarkParked } from "./mark-parked.step.ts"
import type { State, Answer } from "../review-cut.workflow.ts"

export class WaitReviewAgain extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(
            { engine: "engine.room.answered", version: 1 },
            { when: (items: Answer[]) => items.filter((item) => item.choice.startsWith("cut-")) },
            (s, answers: Answer[]) => { answers.forEach((answer) => s.answers.push(answer)) },
        ),
    ]
    override readonly timeout = (s: StateOf<typeof State>) => new Date(Date.parse(s.card?.secondReviewBy ?? ""))
    override readonly next = IsApproved
    override readonly onTimeout = MarkParked
}
