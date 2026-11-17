import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../signal.workflow.ts"
import { Touch } from "./touch.step.ts"
import { HeldSendOpener } from "./held-send-opener.step.ts"

export class SentSendOpener extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.sent.sent === true
    override readonly yes = Touch
    override readonly no = HeldSendOpener
}
