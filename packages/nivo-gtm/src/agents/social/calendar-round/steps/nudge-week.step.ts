import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { PostCard as PostCardCell } from "../../../../common/recover/post-card.cell.ts"
import { WaitWeekAgain } from "./wait-week-again.step.ts"
import type { State } from "../calendar-round.workflow.ts"

export class NudgeWeek extends NodeRun(PostCardCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ text: s.filed.nudgeText })
    override readonly into = ["nudged"] as const
    override readonly next = WaitWeekAgain
}
