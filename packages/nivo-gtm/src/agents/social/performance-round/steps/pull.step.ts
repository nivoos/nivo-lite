import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialPull as PullCell } from "../pull.cell.ts"
import { SaveMetrics } from "./save-metrics.step.ts"
import type { State } from "../performance-round.workflow.ts"

export class Pull extends NodeRun(PullCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ instant: s.tick.instant })
    override readonly into = ["pull"] as const
    override readonly next = SaveMetrics
}
