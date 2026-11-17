import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { ParkAlert as ParkAlertCell } from "../../../../common/recover/park-alert.cell.ts"
import { Parked } from "./parked.step.ts"
import type { State } from "../post-draft.workflow.ts"

export class AlertPark extends NodeRun(ParkAlertCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ what: "Bài đăng chưa được duyệt", ref: s.saved.code, nextAction: "Duyệt hoặc sửa bài rồi chuyển trạng thái về chosen" })
    override readonly into = ["parked"] as const
    override readonly next = Parked
}
