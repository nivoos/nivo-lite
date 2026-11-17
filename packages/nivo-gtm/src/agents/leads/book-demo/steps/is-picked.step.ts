import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { Book } from "./book.step.ts"
import { SendInvite } from "./send-invite.step.ts"

export class IsPicked extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.pick.picked === true
    override readonly yes = Book
    override readonly no = SendInvite
}
