import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import { Schedule } from "./schedule.step.ts"
import { CancelWeek } from "./cancel-week.step.ts"
import type { State } from "../calendar-round.workflow.ts"

/** Branch: did the reviewer approve the whole week (the last card answer is `week-approve`). */
export class IsApproved extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.answers.at(-1).choice === "week-approve"
    override readonly label = { vi: "Duyệt cả tuần?", en: "Week approved?" }
    override readonly yes = Schedule
    override readonly no = CancelWeek
}
