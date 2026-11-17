import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { ParkAlert as ParkAlertCell } from "../../../../common/recover/park-alert.cell.ts"
import type { State } from "../book-demo.workflow.ts"
import { EndParked } from "./end-parked.step.ts"

export class ParkFailed extends NodeRun(ParkAlertCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ what: "Một bước chăm khách bị từ chối sau khi đã thử lại", ref: s.leadId, nextAction: "Xem thẻ lỗi, sửa nguyên nhân rồi chuyển khách về giai đoạn trước để luồng chạy lại" })
    override readonly into = ["alert"] as const
    override readonly next = EndParked
}
