import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SendLine as SendLineCell } from "../../common/send-line.cell.ts"
import type { State } from "../signal.workflow.ts"
import { IsSent } from "./is-sent.step.ts"
import { EndDeclined } from "./end-declined.step.ts"

/** The opener leaves the company: a person approves it first (`ask`, locked by the engine). */
export class SendOpener extends NodeRun(SendLineCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ to: s.lead.code, text: s.opener.text })
    override readonly into = ["sent"] as const
    override readonly next = IsSent
    override readonly onDeclined = EndDeclined
}
