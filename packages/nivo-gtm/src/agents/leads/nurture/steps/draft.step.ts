import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { DraftFollowUp as DraftFollowUpCell } from "../draft-follow-up.cell.ts"
import type { State } from "../nurture.workflow.ts"
import { OkDraft } from "./ok-draft.step.ts"

export class Draft extends NodeRun(DraftFollowUpCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ leadId: s.leadId })
    override readonly into = ["draft"] as const
    override readonly next = OkDraft
}
