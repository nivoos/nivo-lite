import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { RetryDecision as RetryDecisionCell } from "../../../../common/recover/retry-decision.cell.ts"
import type { State } from "../signal.workflow.ts"
import { IsAgain } from "./is-again.step.ts"

/** A step was refused: the recovery rule decides whether to try again (the caps are customer settings with defaults). */
export class Retry extends NodeRun(RetryDecisionCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ attempt: s.retry.attempt ?? 0 })
    override readonly into = ["retry"] as const
    override readonly next = IsAgain
}
