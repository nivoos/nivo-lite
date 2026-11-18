import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialSchedule as ScheduleCell } from "../schedule.cell.ts"
import { Scheduled } from "./scheduled.step.ts"
import type { State } from "../calendar-round.workflow.ts"

/** The week was approved: marks every publication filed for it `scheduled`. */
export class Schedule extends NodeRun(ScheduleCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ filed: s.filed.filed, status: "scheduled" as const })
    override readonly into = ["settled"] as const
    override readonly next = Scheduled
}
