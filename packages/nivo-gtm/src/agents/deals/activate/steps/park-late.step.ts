import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { ParkAlert as ParkAlertCell } from "../../../../common/recover/park-alert.cell.ts"
import type { State } from "../activate.workflow.ts"
import { Parked } from "./parked.step.ts"

/** The activator did not answer in a day. */
export class ParkLate extends NodeRun(ParkAlertCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ what: "Chưa ai kích hoạt gói sau một ngày", ref: s.deal.code, nextAction: "Kích hoạt gói cho khách rồi báo lại" })
    override readonly into = ["alert"] as const
    override readonly next = Parked
}
