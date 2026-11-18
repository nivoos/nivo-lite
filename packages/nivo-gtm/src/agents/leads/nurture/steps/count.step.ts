import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { CountFollowUp as CountFollowUpCell } from "../count-follow-up.cell.ts"
import type { State } from "../nurture.workflow.ts"
import { Wait } from "./wait.step.ts"

/** Runs `CountFollowUp` (counts the follow-up that went out: one act, `object.update` of `gtm.lead` (follow-ups + 1, last contact now, the next action "wait for the lead" due when the next follow-up does, or in a week when none is left)) and keeps its result in `counted`; the run then goes to `Wait`. */
export class Count extends NodeRun(CountFollowUpCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ leadId: s.leadId, nextDueMs: s.check.nextDueMs })
    override readonly into = ["counted"] as const
    override readonly next = Wait
}
