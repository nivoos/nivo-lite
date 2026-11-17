import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { SendEmail } from "./send-email.step.ts"
import { TellHost } from "./tell-host.step.ts"

export class HasEmail extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.pick.email !== ""
    override readonly yes = SendEmail
    override readonly no = TellHost
}
