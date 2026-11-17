import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { TouchLead as TouchLeadCell } from "../../common/touch-lead.cell.ts"
import type { State } from "../book-demo.workflow.ts"
import { OkNoteInvite } from "./ok-note-invite.step.ts"

export class NoteInvite extends NodeRun(TouchLeadCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ leadId: s.leadId, note: "Đã mời khách chọn giờ demo", nextAction: "Chờ khách chọn giờ demo", engage: false })
    override readonly into = ["touched"] as const
    override readonly next = OkNoteInvite
}
