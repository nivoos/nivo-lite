import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { PostCardOutput } from "../../../common/recover/post-card.cell.ts"
import { PullOutput } from "./pull.cell.ts"
import { SaveMetricsOutput } from "./save-metrics.cell.ts"
import { ReportOutput } from "./report.cell.ts"
import { SheetOutput } from "./sheet.cell.ts"
import { keyOf } from "../../../package-key.ts"
import { Tick } from "./steps/tick.step.ts"
import { Pull } from "./steps/pull.step.ts"
import { SaveMetrics } from "./steps/save-metrics.step.ts"
import { IsMonday } from "./steps/is-monday.step.ts"
import { Report } from "./steps/report.step.ts"
import { PostReport } from "./steps/post-report.step.ts"
import { Sheet } from "./steps/sheet.step.ts"
import { Done } from "./steps/done.step.ts"

/** The one state object of a run. */
export const State = z.strictObject({
    tick: z.strictObject({ instant: z.string().min(10) }).optional(),
    pull: PullOutput.optional(),
    saved: SaveMetricsOutput.optional(),
    report: ReportOutput.optional(),
    posted: PostCardOutput.optional(),
    sheet: SheetOutput.optional(),
})

/**
 * `nivo-gtm.social-performance-round` (Đo hiệu quả): the clock opens a run at 09:00 every day (Ho Chi Minh City). The publications of the last `metricDays` days are pulled and their numbers saved with the time they were looked at. On a Monday
 * ONE generation writes the weekly report (the exact figures, ONE suggestion), it is posted as a card to the team room and one row is appended to the KPI sheet. Nothing leaves the company, so every step runs `auto`.
 */
export class PerformanceRound implements Workflow<typeof State> {
    readonly key = keyOf("social-performance-round")
    readonly version = 1
    readonly title = {"vi":"Đo hiệu quả","en":"Performance round"}
    readonly state = State
    readonly start = Tick
    readonly steps = [Tick, Pull, SaveMetrics, IsMonday, Report, PostReport, Sheet, Done]
}
