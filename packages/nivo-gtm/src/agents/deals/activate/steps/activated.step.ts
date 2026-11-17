import { NodeWait, fromSetting, take } from "@starci/nivoos-sdk"
import { RequestActivation } from "../../cells/request-activation.cell.ts"
import type { State, Answer } from "../activate.workflow.ts"
import { Done } from "./done.step.ts"
import { Late } from "./late.step.ts"

/** The activator answers within the hours of the setting `answerHours` (a day by default). */
export class Activated extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>({ engine: "engine.room.answered", version: 1 }, {}, (s, answers: Answer[]) => { const [first] = answers; if (first !== undefined) s.answer = first }),
    ]
    override readonly timeout = fromSetting(RequestActivation, "answerHours", "hours")
    override readonly next = Done
    override readonly onTimeout = Late
}
