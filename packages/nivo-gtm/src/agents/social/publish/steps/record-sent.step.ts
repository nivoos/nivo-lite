import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialRecord as RecordCell } from "../record.cell.ts"
import { MarkContent } from "./mark-content.step.ts"
import type { State } from "../publish.workflow.ts"

/** Records the sent post address and reference on its publication. */
export class RecordSent extends NodeRun(RecordCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        publicationId: s.slot.publicationId,
        url: s.sent.url,
        ref: s.sent.ref,
    })
    override readonly into = ["recorded"] as const
    override readonly next = MarkContent
}
