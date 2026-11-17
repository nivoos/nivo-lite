import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SendEmail as SendEmailCell } from "../send-email.cell.ts"
import type { State } from "../book-demo.workflow.ts"
import { TellHost } from "./tell-host.step.ts"

/** The email leaves the company: a person approves it first (`ask`, locked by the engine). */
export class SendEmail extends NodeRun(SendEmailCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ to: s.pick.email, name: s.slots.name, label: s.book.label, link: s.book.link })
    override readonly into = ["emailed"] as const
    override readonly next = TellHost
    override readonly onDeclined = TellHost
}
