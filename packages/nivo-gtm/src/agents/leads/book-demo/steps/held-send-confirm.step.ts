import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { HasEmail } from "./has-email.step.ts"
import { Retry } from "./retry.step.ts"

export class HeldSendConfirm extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.confirmed.refusal === "route_held" || s.confirmed.refusal === "contact_erased"
    override readonly yes = HasEmail
    override readonly no = Retry
}
