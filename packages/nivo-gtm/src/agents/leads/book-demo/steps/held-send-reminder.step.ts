import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { WaitDemoEnd } from "./wait-demo-end.step.ts"
import { Retry } from "./retry.step.ts"

export class HeldSendReminder extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.reminded.refusal === "route_held" || s.reminded.refusal === "contact_erased"
    override readonly yes = WaitDemoEnd
    override readonly no = Retry
}
