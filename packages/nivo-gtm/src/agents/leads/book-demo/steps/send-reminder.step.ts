import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SendReminder as SendReminderCell } from "../send-reminder.cell.ts"
import type { State } from "../book-demo.workflow.ts"
import { SentSendReminder } from "./sent-send-reminder.step.ts"
import { WaitDemoEnd } from "./wait-demo-end.step.ts"

/** The reminder leaves the company: a person approves it first (`ask`, locked by the engine). */
export class SendReminder extends NodeRun(SendReminderCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ to: s.slots.code, label: s.book.label, link: s.book.link })
    override readonly into = ["reminded"] as const
    override readonly next = SentSendReminder
    override readonly onDeclined = WaitDemoEnd
}
