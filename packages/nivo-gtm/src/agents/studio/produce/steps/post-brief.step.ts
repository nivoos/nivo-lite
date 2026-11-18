import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioAskTeam as AskTeamCell } from "../../common/ask-team.cell.ts"
import { WaitCut } from "./wait-cut.step.ts"
import type { State } from "../produce.workflow.ts"

/** Posts the production brief (folder link, shot list, due date) to the team room. */
export class PostBrief extends NodeRun(AskTeamCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ text: s.assigned.cardText })
    override readonly into = ["briefed"] as const
    override readonly next = WaitCut
}
