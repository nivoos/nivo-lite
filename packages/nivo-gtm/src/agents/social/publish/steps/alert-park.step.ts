import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { ParkAlert as ParkAlertCell } from "../../../../common/recover/park-alert.cell.ts"
import { Parked } from "./parked.step.ts"
import type { State } from "../publish.workflow.ts"

export class AlertPark extends NodeRun(ParkAlertCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ what: "Bài đăng chưa đi ra được", ref: s.slot.contentCode, nextAction: "Kiểm tra kênh (chờ kết nối?) rồi chuyển lượt đăng về scheduled" })
    override readonly into = ["parked"] as const
    override readonly next = Parked
}
