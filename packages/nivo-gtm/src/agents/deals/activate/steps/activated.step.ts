import { NodeWait, take } from "@starci/nivoos-sdk"
import type { State, Answer } from "../activate.workflow.ts"
import { Done } from "./done.step.ts"
import { ParkLate } from "./park-late.step.ts"

/** The activator answers within a day. */
export class Activated extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>({ engine: "engine.room.answered", version: 1 }, {}, (s, answers: Answer[]) => { const [first] = answers; if (first !== undefined) s.answer = first }),
    ]
    override readonly timeout = { hours: 24 }
    override readonly next = Done
    override readonly onTimeout = ParkLate
}
