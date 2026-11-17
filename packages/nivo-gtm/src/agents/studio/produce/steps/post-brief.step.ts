import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { PostCard as PostCardCell } from "../../../../common/recover/post-card.cell.ts"
import { WaitCut } from "./wait-cut.step.ts"
import type { State } from "../produce.workflow.ts"

export class PostBrief extends NodeRun(PostCardCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ text: s.assigned.cardText })
    override readonly into = ["briefed"] as const
    override readonly next = WaitCut
}
