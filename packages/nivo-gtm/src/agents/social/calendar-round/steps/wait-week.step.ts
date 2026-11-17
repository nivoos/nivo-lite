import { NodeWait, take, type StateOf } from "@starci/nivoos-sdk"
import { IsApproved } from "./is-approved.step.ts"
import { NudgeWeek } from "./nudge-week.step.ts"
import type { State, Answer } from "../calendar-round.workflow.ts"

export class WaitWeek extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(
            { engine: "engine.room.answered", version: 1 },
            { when: (items: Answer[]) => items.filter((item) => item.choice.startsWith("week-")) },
            (s, answers: Answer[]) => { answers.forEach((answer) => s.answers.push(answer)) },
        ),
    ]
    override readonly timeout = (s: StateOf<typeof State>) => new Date(Date.parse(s.filed?.reviewBy ?? ""))
    override readonly next = IsApproved
    override readonly onTimeout = NudgeWeek
}
