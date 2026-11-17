import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioFileIdeas as FileIdeasCell } from "../file-ideas.cell.ts"
import { PostIdeas } from "./post-ideas.step.ts"
import type { State } from "../idea-round.workflow.ts"

export class FileIdeas extends NodeRun(FileIdeasCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ instant: s.context.instant, ideas: s.ideas.ideas })
    override readonly into = ["filed"] as const
    override readonly next = PostIdeas
}
