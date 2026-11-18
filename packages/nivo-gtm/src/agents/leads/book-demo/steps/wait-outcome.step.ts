import { NodeWait, take } from "@starci/nivoos-sdk"
import type { State, Answer } from "../book-demo.workflow.ts"
import { RecordDemo } from "./record-demo.step.ts"
import { EndOutcomePending } from "./end-outcome-pending.step.ts"

/** Waits for the host's answer to the outcome card (3 days); no answer ends the run `outcome_pending` with the demo still `confirmed`. */
export class WaitOutcome extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>({ engine: "engine.room.answered", version: 1 }, {}, (s, answers: Array<Answer>) => {
            answers.forEach((answer) => s.answers.push(answer))
        }),
    ]
    override readonly timeout = { days: 3 }
    override readonly next = RecordDemo
    override readonly onTimeout = EndOutcomePending
}
