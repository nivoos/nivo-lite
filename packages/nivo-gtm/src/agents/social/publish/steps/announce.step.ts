import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialEmitPublished as EmitPublishedCell } from "../emit-published.cell.ts"
import { Published } from "./published.step.ts"
import type { State } from "../publish.workflow.ts"

export class Announce extends NodeRun(EmitPublishedCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ publicationId: s.slot.publicationId, contentId: s.slot.contentId, channel: s.slot.channel })
    override readonly into = ["announced"] as const
    override readonly next = Published
}
