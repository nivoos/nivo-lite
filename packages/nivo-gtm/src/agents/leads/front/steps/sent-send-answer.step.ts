import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../front.workflow.ts"
import { Readiness } from "./readiness.step.ts"
import { HeldSendAnswer } from "./held-send-answer.step.ts"

export class SentSendAnswer extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.sent.sent === true
    override readonly yes = Readiness
    override readonly no = HeldSendAnswer
}
