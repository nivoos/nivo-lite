import { NodeWait, take, Clock, type ClockTick } from "@starci/nivoos-sdk"
import type { State } from "../report.workflow.ts"
import { Count } from "./count.step.ts"

/** The start: 18:00 on Monday to Saturday, Vietnam time. */
export class Tick extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(
            Clock.cron("0 18 * * 1-6", { zone: "Asia/Ho_Chi_Minh" }),
            {},
            (s, ticks: Array<ClockTick>) => {
                ticks.forEach((tick) => s.ticks.push(tick.instant))
            },
        ),
    ]
    override readonly next = Count
}
