import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { PostCard as PostCardCell } from "../../../../common/recover/post-card.cell.ts"
import { Done } from "./done.step.ts"
import type { State } from "../idea-round.workflow.ts"

export class PostIdeas extends NodeRun(PostCardCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ text: s.filed.cardText, choices: s.filed.choices })
    override readonly into = ["posted"] as const
    override readonly next = Done
}
