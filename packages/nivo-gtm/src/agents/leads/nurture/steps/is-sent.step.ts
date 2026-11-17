import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../nurture.workflow.ts"
import { Count } from "./count.step.ts"
import { EndDeclined } from "./end-declined.step.ts"

export class IsSent extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.sent.sent === true
    override readonly yes = Count
    override readonly no = EndDeclined
}
