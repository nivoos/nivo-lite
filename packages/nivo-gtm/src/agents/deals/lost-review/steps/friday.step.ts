import { NodeWait, take, Clock, type ClockTick } from "@starci/nivoos-sdk"
import type { State } from "../lost-review.workflow.ts"
import { ReadWeek } from "./read-week.step.ts"

/** The start: Friday 16:00. */
export class Friday extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(Clock.cron("0 16 * * 5", { zone: "Asia/Ho_Chi_Minh" }), {}, (s, ticks: Array<ClockTick>) => {
            const first = ticks.at(0)
            if (first !== undefined) s.instant = first.instant
        }),
    ]
    override readonly next = ReadWeek
}
