import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialFinalCheck as FinalCheckCell } from "../final-check.cell.ts"
import { IsOk } from "./is-ok.step.ts"
import type { State } from "../publish.workflow.ts"

export class FinalCheck extends NodeRun(FinalCheckCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ publicationId: s.slot.publicationId, contentId: s.slot.contentId, contentCode: s.slot.contentCode, channel: s.slot.channel, at: s.slot.at, status: s.slot.status, text: s.slot.text })
    override readonly into = ["check"] as const
    override readonly next = IsOk
}
