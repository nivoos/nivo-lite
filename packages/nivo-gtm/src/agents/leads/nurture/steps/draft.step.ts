import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { DraftFollowUp as DraftFollowUpCell } from "../draft-follow-up.cell.ts"
import type { State } from "../nurture.workflow.ts"
import { SendFollowUp } from "./send-follow-up.step.ts"

/** Runs `DraftFollowUp` (how many brain hits the draft reads) and keeps its result in `draft`; the run then goes to `SendFollowUp`. */
export class Draft extends NodeRun(DraftFollowUpCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ leadId: s.leadId })
    override readonly into = ["draft"] as const
    override readonly next = SendFollowUp
}
