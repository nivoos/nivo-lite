import { NodeWait } from "@starci/nivoos-sdk"
import type { State } from "../nurture.workflow.ts"
import { Resume1 } from "./resume1.step.ts"

/** Waits the retry gap (a fixed 15 minutes: a wait takes a constant duration, so the `retryMinutes` setting is read by the decision but not yet by this wait), then goes back to the step that was refused; a pure timer. */
export class RetryWait extends NodeWait<typeof State> {
    override readonly timeout = { minutes: 15 }
    override readonly next = Resume1
    override readonly onTimeout = Resume1
}
