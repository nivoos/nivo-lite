import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioAskTeam as AskTeamCell } from "../../common/ask-team.cell.ts"
import { WaitCutDue } from "./wait-cut-due.step.ts"
import type { State } from "../produce.workflow.ts"

/** Reminds the team that the cut is due soon, then keeps waiting until the due date. */
export class Remind extends NodeRun(AskTeamCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ text: s.assigned.remindText })
    override readonly into = ["reminded"] as const
    override readonly next = WaitCutDue
}
