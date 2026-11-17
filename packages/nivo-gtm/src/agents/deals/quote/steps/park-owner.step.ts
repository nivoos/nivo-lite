import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { ParkAlert as ParkAlertCell } from "../../../../common/recover/park-alert.cell.ts"
import type { State } from "../quote.workflow.ts"
import { Parked } from "./parked.step.ts"

/** The owner did not answer in a day. */
export class ParkOwner extends NodeRun(ParkAlertCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ what: "Chủ chưa trả lời về mức giảm giá sau một ngày", ref: s.deal.code, nextAction: "Hỏi chủ trực tiếp, rồi điền lại gói để báo giá lại" })
    override readonly into = ["alert"] as const
    override readonly next = Parked
}
