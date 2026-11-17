import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioEmitApproved as EmitApprovedCell } from "../emit-approved.cell.ts"
import { Approved } from "./approved.step.ts"
import type { State } from "../review-cut.workflow.ts"

export class AnnounceApproved extends NodeRun(EmitApprovedCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ contentId: s.cut.contentId, kind: "video" })
    override readonly into = ["announced"] as const
    override readonly next = Approved
}
