import { NodeWait, type StateOf } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { AskOutcome } from "./ask-outcome.step.ts"

/** Waits until an hour after the demo ended; a pure timer. */
export class WaitDemoEnd extends NodeWait<typeof State> {
    override readonly timeout = (s: StateOf<typeof State>) => new Date((s.book?.endMs ?? 0) + 3_600_000)
    override readonly next = AskOutcome
    override readonly onTimeout = AskOutcome
}
