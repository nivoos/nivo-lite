import { NodeWait, type StateOf } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { SendReminder } from "./send-reminder.step.ts"

/** Waits until the reminder is due (`remindHours` before the demo); a pure timer. */
export class WaitRemind extends NodeWait<typeof State> {
    override readonly timeout = (s: StateOf<typeof State>) => new Date(s.book?.remindAtMs ?? 0)
    override readonly next = SendReminder
    override readonly onTimeout = SendReminder
}
