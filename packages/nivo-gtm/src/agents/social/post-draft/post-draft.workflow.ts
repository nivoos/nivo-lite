import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { Changed, RoomAnswer, PostDraft } from "../common/social.shapes.ts"
import { AskTeamOutput } from "../common/ask-team.cell.ts"
import { ReadOutput } from "./read.cell.ts"
import { SaveOutput } from "./save.cell.ts"
import { ApproveOutput } from "./approve.cell.ts"
import { EmitApprovedOutput } from "./emit-approved.cell.ts"
import { keyOf } from "../../../package-key.ts"
import { Open } from "./steps/open.step.ts"
import { Read } from "./steps/read.step.ts"
import { Draft } from "./steps/draft.step.ts"
import { Save } from "./steps/save.step.ts"
import { AskReview } from "./steps/ask-review.step.ts"
import { WaitReview } from "./steps/wait-review.step.ts"
import { NudgeReview } from "./steps/nudge-review.step.ts"
import { WaitReviewAgain } from "./steps/wait-review-again.step.ts"
import { IsApproved } from "./steps/is-approved.step.ts"
import { Approve } from "./steps/approve.step.ts"
import { Announce } from "./steps/announce.step.ts"
import { Approved } from "./steps/approved.step.ts"
import { Revise } from "./steps/revise.step.ts"
import { IsRevised } from "./steps/is-revised.step.ts"
import { NoReview } from "./steps/no-review.step.ts"
import { MaxRevisions } from "./steps/max-revisions.step.ts"

/** The one state object of a run. */
export const State = z.strictObject({
    change: Changed.optional(),
    brief: ReadOutput.optional(),
    draft: PostDraft.optional(),
    saved: SaveOutput.optional(),
    asked: AskTeamOutput.optional(),
    nudged: AskTeamOutput.optional(),
    answers: z.array(RoomAnswer).max(20).optional(),
    approved: ApproveOutput.optional(),
    announced: EmitApprovedOutput.optional(),
})
/** The room answer a review card gets: which choice, by whom, in which message. */
export type Answer = z.infer<typeof RoomAnswer>

/**
 * `nivo-gtm.social-post-draft` (Soạn bài đăng): a post idea a person chose (`gtm.content`, kind `post`, status `chosen`) opens a run. The idea and the brain are read, ONE generation writes the caption, hashtags and image text, the
 * draft is saved on the item (status `script_review`) and ONE card asks a person to approve it. Duyệt: the item is `approved` and `nivo-gtm.content.approved` is emitted (the calendar plans it). Sửa: rewritten up to
 * `maxRevisions` times, then the run ends `max_revisions`. No answer: one nudge, then the run ends `no_review`. Nothing leaves the company here: the send is approved again at `publish`.
 */
export class PostDraftFlow implements Workflow<typeof State> {
    readonly key = keyOf("social-post-draft")
    readonly version = 2
    readonly title = { vi: "Soạn bài đăng", en: "Draft a post" }
    readonly state = State
    readonly append = ["answers"] as const
    readonly start = Open
    readonly steps = [
        Open,
        Read,
        Draft,
        Save,
        AskReview,
        WaitReview,
        NudgeReview,
        WaitReviewAgain,
        IsApproved,
        Approve,
        Announce,
        Approved,
        Revise,
        IsRevised,
        NoReview,
        MaxRevisions,
    ]
}
