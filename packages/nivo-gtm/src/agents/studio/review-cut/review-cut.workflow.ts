import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { RoomAnswer } from "../common/studio.shapes.ts"
import { CutReadyData } from "../../../common/events/cut-ready.event.ts"
import { PostCardOutput } from "../../../common/recover/post-card.cell.ts"
import { ParkAlertOutput } from "../../../common/recover/park-alert.cell.ts"
import { MarkParkedOutput } from "../common/mark-parked.cell.ts"
import { ReadCutOutput } from "./read-cut.cell.ts"
import { CheckCutOutput } from "./check-cut.cell.ts"
import { ReviewCardOutput } from "./review-card.cell.ts"
import { MarkCutOutput } from "./mark-cut.cell.ts"
import { SetContentStatusOutput } from "./set-content-status.cell.ts"
import { EmitApprovedOutput } from "./emit-approved.cell.ts"
import { keyOf } from "../../../package-key.ts"
import { Open } from "./steps/open.step.ts"
import { ReadCut } from "./steps/read-cut.step.ts"
import { CheckCut } from "./steps/check-cut.step.ts"
import { ReviewCard } from "./steps/review-card.step.ts"
import { AskReview } from "./steps/ask-review.step.ts"
import { WaitReview } from "./steps/wait-review.step.ts"
import { NudgeReview } from "./steps/nudge-review.step.ts"
import { WaitReviewAgain } from "./steps/wait-review-again.step.ts"
import { IsApproved } from "./steps/is-approved.step.ts"
import { MarkCutApproved } from "./steps/mark-cut-approved.step.ts"
import { ContentApproved } from "./steps/content-approved.step.ts"
import { AnnounceApproved } from "./steps/announce-approved.step.ts"
import { Approved } from "./steps/approved.step.ts"
import { MarkCutFix } from "./steps/mark-cut-fix.step.ts"
import { ContentBack } from "./steps/content-back.step.ts"
import { SentBack } from "./steps/sent-back.step.ts"
import { MarkParked } from "./steps/mark-parked.step.ts"
import { AlertPark } from "./steps/alert-park.step.ts"
import { Parked } from "./steps/parked.step.ts"

/** The one state object of a run. */
export const State = z.strictObject({
    cut: CutReadyData.optional(),
    ctx: ReadCutOutput.optional(),
    check: CheckCutOutput.optional(),
    card: ReviewCardOutput.optional(),
    asked: PostCardOutput.optional(),
    nudged: PostCardOutput.optional(),
    answers: z.array(RoomAnswer).max(20).optional(),
    cutMarked: MarkCutOutput.optional(),
    contentMarked: SetContentStatusOutput.optional(),
    announced: EmitApprovedOutput.optional(),
    marked: MarkParkedOutput.optional(),
    parked: ParkAlertOutput.optional(),
})
export type Answer = z.infer<typeof RoomAnswer>
export type Cut = z.infer<typeof CutReadyData>

/**
 * `nivo-gtm.studio-review-cut` (Duyệt bản dựng): `nivo-gtm.cut.ready` opens a run. The cut and its approved script are read, ONE generation writes the review checklist (what the script and the public price document settle;
 * what only watching settles is left to the person), and ONE card gives the cut link, the checklist, Duyệt and Sửa. Duyệt: the cut is `approved`, the item is `approved` with the cut link as its evidence and
 * `nivo-gtm.content.approved` is emitted (the Social agent plans it). Sửa: the cut is marked `fix` and the item goes back to `producing` with the reason as its next action (the `produce` run gives the editor a new date).
 * No answer in `reviewHours`: one nudge, then parked with ONE alert card. The person's Duyệt is the approval of the asset; publishing is approved again per channel.
 */
export class ReviewCut implements Workflow<typeof State> {
    readonly key = keyOf("studio-review-cut")
    readonly version = 1
    readonly title = {"vi":"Duyệt bản dựng","en":"Review the cut"}
    readonly state = State
    readonly append = ["answers"] as const
    readonly start = Open
    readonly steps = [Open, ReadCut, CheckCut, ReviewCard, AskReview, WaitReview, NudgeReview, WaitReviewAgain, IsApproved, MarkCutApproved, ContentApproved, AnnounceApproved, Approved, MarkCutFix, ContentBack, SentBack, MarkParked, AlertPark, Parked]
}
