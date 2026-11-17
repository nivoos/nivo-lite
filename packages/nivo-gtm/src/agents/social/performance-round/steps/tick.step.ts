import { NodeWait, Clock, take, type ClockTick } from "@starci/nivoos-sdk"
import { Pull } from "./pull.step.ts"
import type { State } from "../performance-round.workflow.ts"

/** Every day 09:00, Ho Chi Minh City. */
export class Tick extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(Clock.cron("0 9 * * *", { zone: "Asia/Ho_Chi_Minh" }), {}, (s, ticks: ClockTick[]) => { const [first] = ticks; if (first !== undefined) s.tick = { instant: first.instant } }),
    ]
    override readonly next = Pull
}
