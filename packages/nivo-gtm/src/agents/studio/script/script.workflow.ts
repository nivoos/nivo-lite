import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { Changed, RoomAnswer, ScriptDraft } from "../common/studio.shapes.ts"
import { AskTeamOutput } from "../common/ask-team.cell.ts"
import { ReadBriefOutput } from "./read-brief.cell.ts"
import { SaveScriptOutput } from "./save-script.cell.ts"
import { ApproveScriptOutput } from "./approve-script.cell.ts"
import { keyOf } from "../../../package-key.ts"
import { Open } from "./steps/open.step.ts"
import { ReadBrief } from "./steps/read-brief.step.ts"
import { Draft } from "./steps/draft.step.ts"
import { SaveScript } from "./steps/save-script.step.ts"
import { AskReview } from "./steps/ask-review.step.ts"
import { WaitReview } from "./steps/wait-review.step.ts"
import { NudgeReview } from "./steps/nudge-review.step.ts"
import { WaitReviewAgain } from "./steps/wait-review-again.step.ts"
import { IsApproved } from "./steps/is-approved.step.ts"
import { ApproveScript } from "./steps/approve-script.step.ts"
import { Approved } from "./steps/approved.step.ts"
import { Revise } from "./steps/revise.step.ts"
import { IsRevised } from "./steps/is-revised.step.ts"
import { NoReview } from "./steps/no-review.step.ts"
import { RevisionLimit } from "./steps/revision-limit.step.ts"

/** The one state object of a run. */
export const State = z.strictObject({
    change: Changed.optional(),
    brief: ReadBriefOutput.optional(),
    draft: ScriptDraft.optional(),
    saved: SaveScriptOutput.optional(),
    asked: AskTeamOutput.optional(),
    nudged: AskTeamOutput.optional(),
    answers: z.array(RoomAnswer).max(20).optional(),
    approved: ApproveScriptOutput.optional(),
})
export type Answer = z.infer<typeof RoomAnswer>

/**
 * `nivo-gtm.studio-script` (Viết kịch bản video): a video idea a person chose (`gtm.content`, kind `video`, status `chosen`) opens a run. The brief is read (the idea, the brain, the best past hooks), ONE generation writes
 * the script with its beats, it is saved on the item (status `script_review`) and ONE card asks a person to approve it. Duyệt: the item is `script_ok` (the `produce` workflow starts on that write). Sửa: rewritten up to
 * `maxRevisions` times, then the run ends `revision_limit`. No answer in `reviewHours`: one nudge, then the run ends `no_review`. The approval here is internal (nothing leaves the company), so every step runs `auto`.
 */
export class Script implements Workflow<typeof State> {
    readonly key = keyOf("studio-script")
    readonly version = 2
    readonly title = {"vi":"Viết kịch bản video","en":"Write the video script"}
    readonly state = State
    readonly append = ["answers"] as const
    readonly start = Open
    readonly steps = [Open, ReadBrief, Draft, SaveScript, AskReview, WaitReview, NudgeReview, WaitReviewAgain, IsApproved, ApproveScript, Approved, Revise, IsRevised, NoReview, RevisionLimit]
}
