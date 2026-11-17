import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { TouchLead as TouchLeadCell } from "../../common/touch-lead.cell.ts"
import type { State } from "../signal.workflow.ts"
import { EndOpened } from "./end-opened.step.ts"

export class Touch extends NodeRun(TouchLeadCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ leadId: s.lead.leadId, note: "Đã gửi tin chào đầu tiên", nextAction: "Chờ khách trả lời", engage: true })
    override readonly into = ["touched"] as const
    override readonly next = EndOpened
}
