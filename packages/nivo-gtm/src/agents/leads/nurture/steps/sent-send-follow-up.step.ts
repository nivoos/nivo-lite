import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../nurture.workflow.ts"
import { Count } from "./count.step.ts"
import { HeldSendFollowUp } from "./held-send-follow-up.step.ts"

export class SentSendFollowUp extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.sent.sent === true
    override readonly yes = Count
    override readonly no = HeldSendFollowUp
}
