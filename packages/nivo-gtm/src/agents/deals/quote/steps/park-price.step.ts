import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { ParkAlert as ParkAlertCell } from "../../../../common/recover/park-alert.cell.ts"
import type { State } from "../quote.workflow.ts"
import { Parked } from "./parked.step.ts"

/** A refusal of the price cell: parked with the reason in the next action. */
export class ParkPrice extends NodeRun(ParkAlertCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ what: "Báo giá bị từ chối: mức giảm hoặc gói credit không hợp lệ", ref: s.deal.code, nextAction: "Sửa giảm giá hoặc gói credit trên đơn rồi điền lại gói" })
    override readonly into = ["alert"] as const
    override readonly next = Parked
}
