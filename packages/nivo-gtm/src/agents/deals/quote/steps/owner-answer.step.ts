import { NodeWait, take } from "@starci/nivoos-sdk"
import type { State, Answer } from "../quote.workflow.ts"
import { OwnerOk } from "./owner-ok.step.ts"
import { OwnerSilent } from "./owner-silent.step.ts"

/** The owner decides the discount within a day. */
export class OwnerAnswer extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>({ engine: "engine.room.answered", version: 1 }, {}, (s, answers: Answer[]) => { const [first] = answers; if (first !== undefined) s.answer = first }),
    ]
    override readonly timeout = { hours: 24 }
    override readonly next = OwnerOk
    override readonly onTimeout = OwnerSilent
}
