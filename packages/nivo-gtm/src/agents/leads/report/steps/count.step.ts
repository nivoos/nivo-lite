import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { CountLeads as CountLeadsCell } from "../count-leads.cell.ts"
import type { State } from "../report.workflow.ts"
import { Post } from "./post.step.ts"

export class Count extends NodeRun(CountLeadsCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ instant: s.ticks[0] })
    override readonly into = ["report"] as const
    override readonly next = Post
}
