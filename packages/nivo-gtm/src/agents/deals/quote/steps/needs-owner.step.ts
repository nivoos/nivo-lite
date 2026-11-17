import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../quote.workflow.ts"
import { AskOwner } from "./ask-owner.step.ts"
import { SendQuote } from "./send-quote.step.ts"

export class NeedsOwner extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.price.needsOwner === true
    override readonly yes = AskOwner
    override readonly no = SendQuote
}
