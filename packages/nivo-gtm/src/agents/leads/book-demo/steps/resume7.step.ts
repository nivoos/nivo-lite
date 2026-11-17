import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { SendReminder } from "./send-reminder.step.ts"
import { Resume8 } from "./resume8.step.ts"

export class Resume7 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.reminded.refusal !== undefined && s.reminded.refusal !== ""
    override readonly yes = SendReminder
    override readonly no = Resume8
}
