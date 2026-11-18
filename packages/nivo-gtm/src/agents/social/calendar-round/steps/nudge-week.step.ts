import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialAskTeam as AskTeamCell } from "../../common/ask-team.cell.ts"
import { WaitWeekAgain } from "./wait-week-again.step.ts"
import type { State } from "../calendar-round.workflow.ts"

/** Reminds the team in the room that the week card is still waiting for approval. */
export class NudgeWeek extends NodeRun(AskTeamCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ text: s.filed.nudgeText })
    override readonly into = ["nudged"] as const
    override readonly next = WaitWeekAgain
}
