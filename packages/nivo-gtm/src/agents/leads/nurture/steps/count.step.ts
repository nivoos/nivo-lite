import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { CountFollowUp as CountFollowUpCell } from "../count-follow-up.cell.ts"
import type { State } from "../nurture.workflow.ts"
import { Wait } from "./wait.step.ts"

export class Count extends NodeRun(CountFollowUpCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ leadId: s.leadId, nextDueMs: s.check.nextDueMs })
    override readonly into = ["counted"] as const
    override readonly next = Wait
}
