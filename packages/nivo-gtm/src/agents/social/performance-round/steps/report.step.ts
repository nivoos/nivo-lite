import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialReport as ReportCell } from "../report.cell.ts"
import { PostReport } from "./post-report.step.ts"
import type { State } from "../performance-round.workflow.ts"

export class Report extends NodeRun(ReportCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ instant: s.pull.instant, items: s.pull.items, totals: s.pull.totals })
    override readonly into = ["report"] as const
    override readonly next = PostReport
}
