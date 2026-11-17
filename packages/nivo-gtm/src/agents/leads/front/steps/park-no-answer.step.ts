import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { ParkAlert as ParkAlertCell } from "../../../../common/recover/park-alert.cell.ts"
import type { State } from "../front.workflow.ts"
import { EndParked } from "./end-parked.step.ts"

export class ParkNoAnswer extends NodeRun(ParkAlertCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ what: "Thông tin công khai chưa trả lời được câu hỏi của khách", ref: s.messages[0].chatId, nextAction: "Trả lời khách bằng tay rồi bổ sung thông tin công khai vào Second Brain" })
    override readonly into = ["alert"] as const
    override readonly next = EndParked
}
