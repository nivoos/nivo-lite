import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { EndDeclined } from "./end-declined.step.ts"
import { Retry } from "./retry.step.ts"

export class HeldSendInvite extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.sent.refusal === "route_held" || s.sent.refusal === "contact_erased"
    override readonly yes = EndDeclined
    override readonly no = Retry
}
