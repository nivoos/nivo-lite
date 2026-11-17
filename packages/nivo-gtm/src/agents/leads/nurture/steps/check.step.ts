import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { CheckFollowUp as CheckFollowUpCell } from "../check-follow-up.cell.ts"
import type { State } from "../nurture.workflow.ts"
import { IsStop } from "./is-stop.step.ts"

export class Check extends NodeRun(CheckFollowUpCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ leadId: s.leadId })
    override readonly into = ["check"] as const
    override readonly next = IsStop
}
