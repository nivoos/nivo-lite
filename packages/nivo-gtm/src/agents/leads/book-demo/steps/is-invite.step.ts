import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { SendInvite } from "./send-invite.step.ts"
import { PickSlot } from "./pick-slot.step.ts"

export class IsInvite extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.phase === "invite"
    override readonly yes = SendInvite
    override readonly no = PickSlot
}
