import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialEmitApproved as EmitApprovedCell } from "../emit-approved.cell.ts"
import { Approved } from "./approved.step.ts"
import type { State } from "../post-draft.workflow.ts"

/** Announces on the bus that a post is approved, so the calendar can pick it up. */
export class Announce extends NodeRun(EmitApprovedCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        contentId: s.approved.contentId,
        code: s.approved.code,
    })
    override readonly into = ["announced"] as const
    override readonly next = Approved
}
