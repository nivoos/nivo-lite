import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialApprovePost as ApproveCell } from "../approve.cell.ts"
import { Announce } from "./announce.step.ts"
import type { State } from "../post-draft.workflow.ts"

export class Approve extends NodeRun(ApproveCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ objectId: s.change.objectId, memberId: s.answers.at(-1).memberId })
    override readonly into = ["approved"] as const
    override readonly next = Announce
}
