import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { PostReviewOutput } from "../cells/post-review.cell.ts"
import { LostSummaryOutput } from "../cells/lost-summary.cell.ts"
import { LostWeekOutput } from "../cells/lost-week.cell.ts"
import { Friday } from "./steps/friday.step.ts"
import { ReadWeek } from "./steps/read-week.step.ts"
import { Summarize } from "./steps/summarize.step.ts"
import { Post } from "./steps/post.step.ts"
import { Reviewed } from "./steps/reviewed.step.ts"

/** The one state object of a run: the clock instant, the week read, the review written and the card posted. */
export const State = z.strictObject({
    instant: z.string().max(40).optional(),
    week: LostWeekOutput.optional(),
    summary: LostSummaryOutput.optional(),
    posted: PostReviewOutput.optional(),
})

/**
 * `nivo-gtm.deals-lost-review` (Tổng kết đơn mất): every Friday 16:00 (Asia/Ho_Chi_Minh) the lost deals and the cold or lost leads are read, a model writes the review from those exact figures, and ONE card goes to the
 * sales room. Internal: nothing leaves the company.
 */
export class LostReview implements Workflow<typeof State> {
    readonly key = keyOf("deals-lost-review")
    readonly version = 2
    readonly title = { vi: "Tổng kết đơn mất", en: "Lost-deals review" }
    readonly state = State
    readonly start = Friday
    readonly steps = [Friday, ReadWeek, Summarize, Post, Reviewed]
}
