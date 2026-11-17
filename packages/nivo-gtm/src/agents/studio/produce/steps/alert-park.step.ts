import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { ParkAlert as ParkAlertCell } from "../../../../common/recover/park-alert.cell.ts"
import { Parked } from "./parked.step.ts"
import type { State } from "../produce.workflow.ts"

export class AlertPark extends NodeRun(ParkAlertCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ what: "Quá hạn quay dựng, chưa có bản dựng", ref: s.marked.code, nextAction: "Hỏi người phụ trách, gia hạn rồi chuyển trạng thái về script_ok" })
    override readonly into = ["parked"] as const
    override readonly next = Parked
}
