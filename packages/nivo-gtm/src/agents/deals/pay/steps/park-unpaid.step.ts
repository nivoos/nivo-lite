import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { ParkAlert as ParkAlertCell } from "../../../../common/recover/park-alert.cell.ts"
import type { State } from "../pay.workflow.ts"
import { Parked } from "./parked.step.ts"

/** No money after the reminder. */
export class ParkUnpaid extends NodeRun(ParkAlertCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ what: "Hết hạn chờ thanh toán sau một lần nhắc", ref: s.deal.code, nextAction: "Gọi khách hỏi lý do; còn muốn mua thì chuyển đơn về accepted, không thì đánh dấu mất" })
    override readonly into = ["alert"] as const
    override readonly next = Parked
}
