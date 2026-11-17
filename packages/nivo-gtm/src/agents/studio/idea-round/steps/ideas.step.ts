import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioIdeas as IdeasCell } from "../ideas.cell.ts"
import { FileIdeas } from "./file-ideas.step.ts"
import type { State } from "../idea-round.workflow.ts"

export class Ideas extends NodeRun(IdeasCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ instant: s.context.instant, brain: s.context.brain, metrics: s.context.metrics, recent: s.context.recent, open: s.context.open })
    override readonly into = ["ideas"] as const
    override readonly next = FileIdeas
}
