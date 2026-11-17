import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../nurture.workflow.ts"
import { RetryWait } from "./retry-wait.step.ts"
import { ParkFailed } from "./park-failed.step.ts"

export class IsAgain extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.retry.again === true
    override readonly yes = RetryWait
    override readonly no = ParkFailed
}
