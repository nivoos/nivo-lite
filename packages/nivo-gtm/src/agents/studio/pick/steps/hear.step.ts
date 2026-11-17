import { NodeWait, take } from "@starci/nivoos-sdk"
import { ApplyChoice } from "./apply-choice.step.ts"
import type { State, Answer } from "../pick.workflow.ts"

export class Hear extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(
            { engine: "engine.room.answered", version: 1 },
            { when: (items: Answer[]) => items.filter((item) => item.choice.startsWith("idea-choose:") || item.choice.startsWith("idea-drop:")) },
            (s, answers: Answer[]) => { answers.forEach((answer) => s.answers.push(answer)) },
        ),
    ]
    override readonly next = ApplyChoice
}
