import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../quote.workflow.ts"
import { SendQuote } from "./send-quote.step.ts"
import { OwnerDeclined } from "./owner-declined.step.ts"

/** Branches on the owner's answer: `ok` sends the quote, anything else ends in the declined path. */
export class OwnerOk extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.answer.choice === "ok"
    override readonly yes = SendQuote
    override readonly no = OwnerDeclined
}
