import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SendLine as SendLineCell } from "../../common/send-line.cell.ts"
import type { State } from "../nurture.workflow.ts"
import { Count } from "./count.step.ts"
import { EndDeclined } from "./end-declined.step.ts"

/** The follow-up leaves the company: a person approves it first (`ask`, locked by the engine). A held route or an erased contact ends the run `declined`. */
export class SendFollowUp extends NodeRun(SendLineCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ to: s.check.code, text: s.draft.text })
    override readonly into = ["sent"] as const
    override readonly next = Count
    override readonly onDeclined = EndDeclined
    override readonly onRefused = { route_held: EndDeclined, contact_erased: EndDeclined }
}
