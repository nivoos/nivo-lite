import { NodeWait, fromSetting, take } from "@starci/nivoos-sdk"
import { PostBrief } from "../../cells/post-brief.cell.ts"
import type { State, Answer } from "../handover.workflow.ts"
import { Wants } from "./wants.step.ts"
import { Waiting } from "./waiting.step.ts"

/** The sales person answers the brief card within the hours of the setting `answerHours` (a day by default). */
export class Choose extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>({ engine: "engine.room.answered", version: 1 }, {}, (s, answers: Answer[]) => { const [first] = answers; if (first !== undefined) s.answer = first }),
    ]
    override readonly timeout = fromSetting(PostBrief, "answerHours", "hours")
    override readonly next = Wants
    override readonly onTimeout = Waiting
}
