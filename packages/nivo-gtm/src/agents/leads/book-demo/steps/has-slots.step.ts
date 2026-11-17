import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { IsInvite } from "./is-invite.step.ts"
import { EndNoSlots } from "./end-no-slots.step.ts"

export class HasSlots extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.slots.found === true
    override readonly yes = IsInvite
    override readonly no = EndNoSlots
}
