import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioAskTeam as AskTeamCell } from "../../common/ask-team.cell.ts"
import { WaitCutDue } from "./wait-cut-due.step.ts"
import type { State } from "../produce.workflow.ts"

export class Remind extends NodeRun(AskTeamCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ text: s.assigned.remindText })
    override readonly into = ["reminded"] as const
    override readonly next = WaitCutDue
}
