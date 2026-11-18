import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { PostNoticeOutput } from "../common/post-notice.cell.ts"
import { CountLeadsOutput } from "./count-leads.cell.ts"
import { Tick } from "./steps/tick.step.ts"
import { Count } from "./steps/count.step.ts"
import { Post } from "./steps/post.step.ts"
import { EndReported } from "./steps/end-reported.step.ts"

/** The one state object of a run: the clock instants that opened it, the day's numbers and the post. */
export const State = z.strictObject({
    ticks: z.array(z.string().max(40)).max(10).optional(),
    report: CountLeadsOutput.optional(),
    posted: PostNoticeOutput.optional(),
})

/**
 * `nivo-gtm.leads-daily-report` (Báo cáo chăm khách): at 18:00 Monday to Saturday the agent counts the leads and demos from the objects and posts the report to the sales team's room. Internal: it needs no approval.
 */
export class DailyReport implements Workflow<typeof State> {
    readonly key = keyOf("leads-daily-report")
    readonly version = 2
    readonly title = { vi: "Báo cáo chăm khách cuối ngày", en: "Leads daily report" }
    readonly state = State
    readonly append = ["ticks"] as const
    readonly start = Tick
    readonly steps = [Tick, Count, Post, EndReported]
}
