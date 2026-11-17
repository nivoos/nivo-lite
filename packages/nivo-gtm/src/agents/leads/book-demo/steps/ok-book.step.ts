import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { SendConfirm } from "./send-confirm.step.ts"
import { Retry } from "./retry.step.ts"

export class OkBook extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.book.refusal === ""
    override readonly yes = SendConfirm
    override readonly no = Retry
}
