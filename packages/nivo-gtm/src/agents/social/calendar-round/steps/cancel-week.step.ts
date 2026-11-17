import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialSchedule as ScheduleCell } from "../schedule.cell.ts"
import { ChangesAsked } from "./changes-asked.step.ts"
import type { State } from "../calendar-round.workflow.ts"

export class CancelWeek extends NodeRun(ScheduleCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ filed: s.filed.filed, status: "cancelled" as const })
    override readonly into = ["settled"] as const
    override readonly next = ChangesAsked
}
