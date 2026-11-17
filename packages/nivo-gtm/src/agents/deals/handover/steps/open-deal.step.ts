import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { OpenDeal as OpenDealCell } from "../../cells/open-deal.cell.ts"
import type { State } from "../handover.workflow.ts"
import { PostBrief } from "./post-brief.step.ts"

export class OpenDeal extends NodeRun(OpenDealCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ leadId: s.event.leadId, demoId: s.event.demoId, suggestedPlan: s.brief.suggestedPlan })
    override readonly into = ["deal"] as const
    override readonly next = PostBrief
}
