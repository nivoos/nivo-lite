import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { ParkAlert as ParkAlertCell } from "../../../../common/recover/park-alert.cell.ts"
import { Parked } from "./parked.step.ts"
import type { State } from "../calendar-round.workflow.ts"

export class AlertPark extends NodeRun(ParkAlertCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ what: "Lịch tuần chưa được duyệt", ref: s.filed.weekCode, nextAction: "Xem lại lịch tuần rồi chạy lại vòng lịch" })
    override readonly into = ["parked"] as const
    override readonly next = Parked
}
