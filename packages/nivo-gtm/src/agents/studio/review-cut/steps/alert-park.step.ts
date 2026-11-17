import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { ParkAlert as ParkAlertCell } from "../../../../common/recover/park-alert.cell.ts"
import { Parked } from "./parked.step.ts"
import type { State } from "../review-cut.workflow.ts"

export class AlertPark extends NodeRun(ParkAlertCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ what: "Bản dựng chờ duyệt quá hạn", ref: s.marked.code, nextAction: "Xem bản dựng, rồi đổi trạng thái sang approved (hoặc producing để sửa)" })
    override readonly into = ["parked"] as const
    override readonly next = Parked
}
