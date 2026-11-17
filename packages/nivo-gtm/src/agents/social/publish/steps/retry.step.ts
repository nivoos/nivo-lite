import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialRetry as RetryCell } from "../retry.cell.ts"
import { IfAgain } from "./if-again.step.ts"
import type { State } from "../publish.workflow.ts"

export class Retry extends NodeRun(RetryCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ attempt: s.retry.attempt ?? 0, refusal: s.sent.refusal })
    override readonly into = ["retry"] as const
    override readonly next = IfAgain
}
