import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SendLine as SendLineCell } from "../../common/send-line.cell.ts"
import type { State } from "../front.workflow.ts"
import { Readiness } from "./readiness.step.ts"
import { EndDeclined } from "./end-declined.step.ts"

/** The answer leaves the company: a person approves it first (`ask`, locked by the engine). A held route or an erased contact ends the run `declined`. */
export class SendAnswer extends NodeRun(SendLineCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ to: s.messages[0].chatId, text: s.answer.reply })
    override readonly into = ["sent"] as const
    override readonly next = Readiness
    override readonly onDeclined = EndDeclined
    override readonly onRefused = { route_held: EndDeclined, contact_erased: EndDeclined }
}
