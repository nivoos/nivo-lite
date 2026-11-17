import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { WaitDemoEnd } from "./wait-demo-end.step.ts"
import { HeldSendReminder } from "./held-send-reminder.step.ts"

export class SentSendReminder extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.reminded.sent === true
    override readonly yes = WaitDemoEnd
    override readonly no = HeldSendReminder
}
