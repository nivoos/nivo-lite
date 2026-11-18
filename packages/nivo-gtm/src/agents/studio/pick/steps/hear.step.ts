import { NodeWait, take } from "@starci/nivoos-sdk"
import { ApplyChoice } from "./apply-choice.step.ts"
import type { State, Answer } from "../pick.workflow.ts"

/** Start wait: a room answer whose choice is an idea choice (`idea-choose:` or `idea-drop:`) opens a run; answers to other cards are filtered out. */
export class Hear extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(
            { engine: "engine.room.answered", version: 1 },
            {
                when: (items: Array<Answer>) =>
                    items.filter(
                        (item) => item.choice.startsWith("idea-choose:") || item.choice.startsWith("idea-drop:"),
                    ),
            },
            (s, answers: Array<Answer>) => {
                answers.forEach((answer) => s.answers.push(answer))
            },
        ),
    ]
    override readonly next = ApplyChoice
}
