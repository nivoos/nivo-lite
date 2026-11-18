import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioAskTeam as AskTeamCell } from "../../common/ask-team.cell.ts"
import { WaitReview } from "./wait-review.step.ts"
import type { State } from "../script.workflow.ts"

/** Posts the script review card, with the approve and rewrite choices, to the team room. */
export class AskReview extends NodeRun(AskTeamCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ text: s.saved.cardText, choices: s.saved.choices })
    override readonly into = ["asked"] as const
    override readonly next = WaitReview
}
