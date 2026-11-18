import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioAskTeam as AskTeamCell } from "../../common/ask-team.cell.ts"
import { Done } from "./done.step.ts"
import type { State } from "../idea-round.workflow.ts"

/** Posts the ideas card to the team room, with one Chọn choice per idea and a Bỏ cả tuần choice. */
export class PostIdeas extends NodeRun(AskTeamCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ text: s.filed.cardText, choices: s.filed.choices })
    override readonly into = ["posted"] as const
    override readonly next = Done
}
