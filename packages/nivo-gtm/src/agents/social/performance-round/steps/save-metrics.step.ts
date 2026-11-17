import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialSaveMetrics as SaveMetricsCell } from "../save-metrics.cell.ts"
import { IsMonday } from "./is-monday.step.ts"
import type { State } from "../performance-round.workflow.ts"

export class SaveMetrics extends NodeRun(SaveMetricsCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ items: s.pull.items })
    override readonly into = ["saved"] as const
    override readonly next = IsMonday
}
