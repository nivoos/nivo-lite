import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioApproveScript as ApproveScriptCell } from "../approve-script.cell.ts"
import { Approved } from "./approved.step.ts"
import type { State } from "../script.workflow.ts"

export class ApproveScript extends NodeRun(ApproveScriptCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ objectId: s.change.objectId, memberId: s.answers.at(-1).memberId })
    override readonly into = ["approved"] as const
    override readonly next = Approved
}
