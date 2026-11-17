import { NodeWait, take } from "@starci/nivoos-sdk"
import type { State, Answer } from "../handover.workflow.ts"
import { Wants } from "./wants.step.ts"
import { Waiting } from "./waiting.step.ts"

/** The sales person answers the brief card within a day. */
export class Choose extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>({ engine: "engine.room.answered", version: 1 }, {}, (s, answers: Answer[]) => { const [first] = answers; if (first !== undefined) s.answer = first }),
    ]
    override readonly timeout = { hours: 24 }
    override readonly next = Wants
    override readonly onTimeout = Waiting
}
