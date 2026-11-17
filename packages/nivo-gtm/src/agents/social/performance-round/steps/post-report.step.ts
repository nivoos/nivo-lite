import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialAskTeam as AskTeamCell } from "../../common/ask-team.cell.ts"
import { Sheet } from "./sheet.step.ts"
import type { State } from "../performance-round.workflow.ts"

export class PostReport extends NodeRun(AskTeamCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ text: s.report.cardText })
    override readonly into = ["posted"] as const
    override readonly next = Sheet
}
