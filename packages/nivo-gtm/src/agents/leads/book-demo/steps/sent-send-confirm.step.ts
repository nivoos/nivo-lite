import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { HasEmail } from "./has-email.step.ts"
import { HeldSendConfirm } from "./held-send-confirm.step.ts"

export class SentSendConfirm extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.confirmed.sent === true
    override readonly yes = HasEmail
    override readonly no = HeldSendConfirm
}
