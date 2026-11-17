import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialAskTeam as AskTeamCell } from "../../common/ask-team.cell.ts"
import { Noticed } from "./noticed.step.ts"
import type { State } from "../replies.workflow.ts"

export class Notice extends NodeRun(AskTeamCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ text: s.sorted.noticeText })
    override readonly into = ["noticed"] as const
    override readonly next = Noticed
}
