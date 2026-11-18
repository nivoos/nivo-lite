import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioAskTeam as AskTeamCell } from "../../common/ask-team.cell.ts"
import { CutOverdue } from "./cut-overdue.step.ts"
import type { State } from "../produce.workflow.ts"

/** Tells the team once that the due date passed with no cut. */
export class Overdue extends NodeRun(AskTeamCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ text: s.assigned.overdueText })
    override readonly into = ["overdue"] as const
    override readonly next = CutOverdue
}
