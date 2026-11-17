import { NodeWait, Clock, take, type ClockTick } from "@starci/nivoos-sdk"
import { Read } from "./read.step.ts"
import type { State } from "../calendar-round.workflow.ts"

/** Friday 15:00, Ho Chi Minh City: one run a week. */
export class Tick extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(Clock.cron("0 15 * * 5", { zone: "Asia/Ho_Chi_Minh" }), {}, (s, ticks: ClockTick[]) => { const [first] = ticks; if (first !== undefined) s.tick = { instant: first.instant } }),
    ]
    override readonly next = Read
}
