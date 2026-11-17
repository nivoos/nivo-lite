import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { RoomAnswer } from "../common/social.shapes.ts"
import { PostCardOutput } from "../../../common/recover/post-card.cell.ts"
import { ParkAlertOutput } from "../../../common/recover/park-alert.cell.ts"
import { ReadOutput } from "./read.cell.ts"
import { PlanOutput } from "./plan.cell.ts"
import { FileSlotsOutput } from "./file-slots.cell.ts"
import { MirrorOutput } from "./mirror.cell.ts"
import { ScheduleOutput } from "./schedule.cell.ts"
import { keyOf } from "../../../package-key.ts"
import { Tick } from "./steps/tick.step.ts"
import { Read } from "./steps/read.step.ts"
import { HasItems } from "./steps/has-items.step.ts"
import { NothingToPlan } from "./steps/nothing-to-plan.step.ts"
import { Plan } from "./steps/plan.step.ts"
import { FileSlots } from "./steps/file-slots.step.ts"
import { Mirror } from "./steps/mirror.step.ts"
import { PostWeek } from "./steps/post-week.step.ts"
import { WaitWeek } from "./steps/wait-week.step.ts"
import { NudgeWeek } from "./steps/nudge-week.step.ts"
import { WaitWeekAgain } from "./steps/wait-week-again.step.ts"
import { IsApproved } from "./steps/is-approved.step.ts"
import { Schedule } from "./steps/schedule.step.ts"
import { Scheduled } from "./steps/scheduled.step.ts"
import { CancelWeek } from "./steps/cancel-week.step.ts"
import { AlertPark } from "./steps/alert-park.step.ts"
import { Parked } from "./steps/parked.step.ts"

/** The one state object of a run. */
export const State = z.strictObject({
    tick: z.strictObject({ instant: z.string().min(10) }).optional(),
    read: ReadOutput.optional(),
    plan: PlanOutput.optional(),
    filed: FileSlotsOutput.optional(),
    mirror: MirrorOutput.optional(),
    posted: PostCardOutput.optional(),
    nudged: PostCardOutput.optional(),
    answers: z.array(RoomAnswer).max(20).optional(),
    settled: ScheduleOutput.optional(),
    parked: ParkAlertOutput.optional(),
})
export type Answer = z.infer<typeof RoomAnswer>

/**
 * `nivo-gtm.social-calendar-round` (Lịch đăng tuần): the clock opens a run at 15:00 every Friday (Ho Chi Minh City). The approved content with no publication is read, ONE generation places it on channels, days and hours
 * (only a channel with a cadence above 0; Facebook, TikTok and YouTube are "chờ kết nối"), each slot is filed as a `gtm.publication` (`planned`), mirrored to the calendar sheet when one is set, and ONE card asks a person to approve the
 * week. Approved: every publication becomes `scheduled` (and opens `publish`). Sửa, or no answer after one nudge: the plan is cancelled or left, and ONE alert card parks the run.
 */
export class CalendarRound implements Workflow<typeof State> {
    readonly key = keyOf("social-calendar-round")
    readonly version = 1
    readonly title = {"vi":"Lịch đăng tuần","en":"Weekly calendar"}
    readonly state = State
    readonly append = ["answers"] as const
    readonly start = Tick
    readonly steps = [Tick, Read, HasItems, NothingToPlan, Plan, FileSlots, Mirror, PostWeek, WaitWeek, NudgeWeek, WaitWeekAgain, IsApproved, Schedule, Scheduled, CancelWeek, AlertPark, Parked]
}
