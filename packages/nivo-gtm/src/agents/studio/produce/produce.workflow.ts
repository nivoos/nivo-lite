import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { Changed } from "../common/studio.shapes.ts"
import { AskTeamOutput } from "../common/ask-team.cell.ts"
import { PrepareFolderOutput } from "./prepare-folder.cell.ts"
import { ShotListOutput } from "./shot-list.cell.ts"
import { AssignedShape } from "./assign.cell.ts"
import { RecordCutOutput } from "./record-cut.cell.ts"
import { EmitCutReadyOutput } from "./emit-cut-ready.cell.ts"
import { keyOf } from "../../../package-key.ts"
import { Open } from "./steps/open.step.ts"
import { PrepareFolder } from "./steps/prepare-folder.step.ts"
import { ShotList } from "./steps/shot-list.step.ts"
import { Assign } from "./steps/assign.step.ts"
import { PostBrief } from "./steps/post-brief.step.ts"
import { WaitCut } from "./steps/wait-cut.step.ts"
import { Remind } from "./steps/remind.step.ts"
import { WaitCutDue } from "./steps/wait-cut-due.step.ts"
import { RecordCut } from "./steps/record-cut.step.ts"
import { EmitCutReady } from "./steps/emit-cut-ready.step.ts"
import { WaitVerdict } from "./steps/wait-verdict.step.ts"
import { IsApproved } from "./steps/is-approved.step.ts"
import { Rework } from "./steps/rework.step.ts"
import { Produced } from "./steps/produced.step.ts"
import { Overdue } from "./steps/overdue.step.ts"
import { CutOverdue } from "./steps/cut-overdue.step.ts"

/** The one state object of a run. */
export const State = z.strictObject({
    change: Changed.optional(),
    folder: PrepareFolderOutput.optional(),
    shots: ShotListOutput.optional(),
    assigned: AssignedShape.optional(),
    briefed: AskTeamOutput.optional(),
    reminded: AskTeamOutput.optional(),
    overdue: AskTeamOutput.optional(),
    cut: z.strictObject({ objectId: z.string().min(1), link: z.string().max(2000) }).optional(),
    recorded: RecordCutOutput.optional(),
    emitted: EmitCutReadyOutput.optional(),
    verdict: z.strictObject({ to: z.string().max(40) }).optional(),
})

/**
 * `nivo-gtm.studio-produce` (Quay và dựng video): the PERSON path. A script a person approved (`gtm.content`, kind `video`, status `script_ok`) opens a run: the shoot folder is named (Drive is the provider seam, "chờ kết nối"),
 * ONE generation writes the shot list, the item is assigned (status `producing`, an owner, a due date) and ONE card briefs the person. They shoot and edit, then set the item to `cut_ready` with the cut link in the
 * evidence. The agent reminds them `remindHours` before the due date, and tells the team once, ending `cut_overdue`, when the due date passes. A cut is recorded (`gtm.video-cut`) and `nivo-gtm.cut.ready` is emitted; the run then waits
 * for the verdict of `review-cut`: approved ends it, sent back gives the editor a new date and waits for the next cut. Nothing leaves the company, so every step runs `auto`.
 */
export class Produce implements Workflow<typeof State> {
    readonly key = keyOf("studio-produce")
    readonly version = 2
    readonly title = {"vi":"Quay và dựng video","en":"Shoot and edit the video"}
    readonly state = State
    readonly start = Open
    readonly steps = [Open, PrepareFolder, ShotList, Assign, PostBrief, WaitCut, Remind, WaitCutDue, RecordCut, EmitCutReady, WaitVerdict, IsApproved, Rework, Produced, Overdue, CutOverdue]
}
