import { NodeWait, fromSetting, take } from "@starci/nivoos-sdk"
import { AskOwner } from "../../cells/ask-owner.cell.ts"
import type { State, Answer } from "../quote.workflow.ts"
import { OwnerOk } from "./owner-ok.step.ts"
import { OwnerSilent } from "./owner-silent.step.ts"

/** The owner decides the discount within the hours of the setting `answerHours` (a day by default). */
export class OwnerAnswer extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>({ engine: "engine.room.answered", version: 1 }, {}, (s, answers: Array<Answer>) => {
            const first = answers.at(0)
            if (first !== undefined) s.answer = first
        }),
    ]
    override readonly timeout = fromSetting(AskOwner, "answerHours", "hours")
    override readonly next = OwnerOk
    override readonly onTimeout = OwnerSilent
}
