import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { ParkAlert as ParkAlertCell } from "../../../../common/recover/park-alert.cell.ts"
import { Parked } from "./parked.step.ts"
import type { State } from "../script.workflow.ts"

export class AlertPark extends NodeRun(ParkAlertCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ what: "Kịch bản chờ duyệt quá hạn hoặc đã sửa quá số lần cho phép", ref: s.marked.code, nextAction: "Đọc kịch bản, duyệt hoặc chuyển trạng thái về chosen để viết lại" })
    override readonly into = ["parked"] as const
    override readonly next = Parked
}
