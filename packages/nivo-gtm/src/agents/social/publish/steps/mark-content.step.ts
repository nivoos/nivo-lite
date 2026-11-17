import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialMarkContentPublished as MarkContentCell } from "../mark-content.cell.ts"
import { Announce } from "./announce.step.ts"
import type { State } from "../publish.workflow.ts"

export class MarkContent extends NodeRun(MarkContentCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ contentId: s.slot.contentId })
    override readonly into = ["contentMarked"] as const
    override readonly next = Announce
}
