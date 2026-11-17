import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { LostSummary as LostSummaryCell } from "../../cells/lost-summary.cell.ts"
import type { State } from "../lost-review.workflow.ts"
import { Post } from "./post.step.ts"

export class Summarize extends NodeRun(LostSummaryCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ lostDeals: s.week.lostDeals, coldLeads: s.week.coldLeads, lostLeads: s.week.lostLeads, lines: s.week.lines })
    override readonly into = ["summary"] as const
    override readonly next = Post
}
