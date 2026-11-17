import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { ParkAlert as ParkAlertCell } from "../../../../common/recover/park-alert.cell.ts"
import type { State } from "../quote.workflow.ts"
import { Parked } from "./parked.step.ts"

/** The channel refused the send (a member holds the route, or the contact was erased). */
export class ParkSend extends NodeRun(ParkAlertCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ what: "Không gửi được báo giá cho khách: kênh từ chối", ref: s.deal.code, nextAction: "Liên hệ khách bằng cách khác rồi điền lại gói" })
    override readonly into = ["alert"] as const
    override readonly next = Parked
}
