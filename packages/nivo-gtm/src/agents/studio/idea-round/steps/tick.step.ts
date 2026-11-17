import { NodeWait, Clock, take, type ClockTick } from "@starci/nivoos-sdk"
import { ReadContext } from "./read-context.step.ts"
import type { State } from "../idea-round.workflow.ts"

/** Monday 08:00, Ho Chi Minh City: one run a week. */
export class Tick extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(Clock.cron("0 8 * * 1", { zone: "Asia/Ho_Chi_Minh" }), {}, (s, ticks: ClockTick[]) => { const [first] = ticks; if (first !== undefined) s.tick = { instant: first.instant } }),
    ]
    override readonly next = ReadContext
}
