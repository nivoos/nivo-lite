import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialAskTeam as AskTeamCell } from "../../common/ask-team.cell.ts"
import { WaitWeek } from "./wait-week.step.ts"
import type { State } from "../calendar-round.workflow.ts"

export class PostWeek extends NodeRun(AskTeamCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ text: s.filed.cardText, choices: s.filed.choices })
    override readonly into = ["posted"] as const
    override readonly next = WaitWeek
}
