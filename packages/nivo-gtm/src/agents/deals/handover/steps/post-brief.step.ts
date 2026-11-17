import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { PostBrief as PostBriefCell } from "../../cells/post-brief.cell.ts"
import type { State } from "../handover.workflow.ts"
import { Choose } from "./choose.step.ts"

export class PostBrief extends NodeRun(PostBriefCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ code: s.deal.code, owner: s.deal.owner, leadName: s.brief.leadName, summary: s.brief.summary, objections: s.brief.objections, suggestedPlan: s.brief.suggestedPlan })
    override readonly into = ["posted"] as const
    override readonly next = Choose
}
