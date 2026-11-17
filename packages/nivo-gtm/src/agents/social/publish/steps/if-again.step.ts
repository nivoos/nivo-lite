import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import { RetryWait } from "./retry-wait.step.ts"
import { MarkParked } from "./mark-parked.step.ts"
import type { State } from "../publish.workflow.ts"

export class IfAgain extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.retry.again === true
    override readonly label = { vi: "Thử lại?", en: "Try again?" }
    override readonly yes = RetryWait
    override readonly no = MarkParked
}
