import { NodeWait, type StateOf } from "@starci/nivoos-sdk"
import type { State } from "../nurture.workflow.ts"
import { Check } from "./check.step.ts"

/** Waits until the check says the next follow-up may be due (the gap, then the sending window); a pure timer: it takes no event, so a lead's own reply is read by the next check, not by this wait. */
export class Wait extends NodeWait<typeof State> {
    override readonly timeout = (s: StateOf<typeof State>) => new Date(s.check?.waitUntilMs ?? 0)
    override readonly next = Check
    override readonly onTimeout = Check
}
