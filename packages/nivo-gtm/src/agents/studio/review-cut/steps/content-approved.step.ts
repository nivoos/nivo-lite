import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioSetContentStatus as SetContentStatusCell } from "../set-content-status.cell.ts"
import { AnnounceApproved } from "./announce-approved.step.ts"
import type { State } from "../review-cut.workflow.ts"

export class ContentApproved extends NodeRun(SetContentStatusCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ objectId: s.cut.contentId, status: "approved" as const, nextAction: "Lên lịch đăng", evidence: s.ctx.fileLink })
    override readonly into = ["contentMarked"] as const
    override readonly next = AnnounceApproved
}
