import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { ParkAlert as ParkAlertCell } from "../../../../common/recover/park-alert.cell.ts"
import type { State } from "../pay.workflow.ts"
import { Parked } from "./parked.step.ts"

/** A transfer with the right code but less money than the deal. */
export class ParkShort extends NodeRun(ParkAlertCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ what: "Khách chuyển thiếu tiền", ref: s.deal.code, nextAction: "Liên hệ khách để chuyển bù, rồi chuyển đơn về accepted" })
    override readonly into = ["alert"] as const
    override readonly next = Parked
}
