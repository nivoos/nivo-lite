import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { PostCard as PostCardCell } from "../../../../common/recover/post-card.cell.ts"
import { Sheet } from "./sheet.step.ts"
import type { State } from "../performance-round.workflow.ts"

export class PostReport extends NodeRun(PostCardCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ text: s.report.cardText })
    override readonly into = ["posted"] as const
    override readonly next = Sheet
}
