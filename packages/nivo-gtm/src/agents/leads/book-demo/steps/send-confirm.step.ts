import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SendConfirm as SendConfirmCell } from "../send-confirm.cell.ts"
import type { State } from "../book-demo.workflow.ts"
import { SentSendConfirm } from "./sent-send-confirm.step.ts"
import { HasEmail } from "./has-email.step.ts"

/** The confirmation leaves the company: a person approves it first (`ask`, locked by the engine). A decline still leaves the demo booked. */
export class SendConfirm extends NodeRun(SendConfirmCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ to: s.slots.code, label: s.book.label, link: s.book.link })
    override readonly into = ["confirmed"] as const
    override readonly next = SentSendConfirm
    override readonly onDeclined = HasEmail
}
