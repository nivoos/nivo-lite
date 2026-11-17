import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialAskTeam as AskTeamCell } from "../../common/ask-team.cell.ts"
import { WaitReview } from "./wait-review.step.ts"
import type { State } from "../post-draft.workflow.ts"

export class AskReview extends NodeRun(AskTeamCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ text: s.saved.cardText, choices: s.saved.choices })
    override readonly into = ["asked"] as const
    override readonly next = WaitReview
}
