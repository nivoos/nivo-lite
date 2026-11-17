import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { ParkAlert as ParkAlertCell } from "../../../../common/recover/park-alert.cell.ts"
import type { State } from "../pay.workflow.ts"
import { Parked } from "./parked.step.ts"

/** The channel refused the send. */
export class ParkSend extends NodeRun(ParkAlertCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ what: "Không gửi được thông tin chuyển khoản: kênh từ chối", ref: s.deal.code, nextAction: "Liên hệ khách bằng cách khác rồi chuyển đơn về accepted" })
    override readonly into = ["alert"] as const
    override readonly next = Parked
}
