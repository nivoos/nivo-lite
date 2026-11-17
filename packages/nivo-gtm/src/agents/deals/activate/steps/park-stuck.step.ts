import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { ParkAlert as ParkAlertCell } from "../../../../common/recover/park-alert.cell.ts"
import type { State } from "../activate.workflow.ts"
import { Parked } from "./parked.step.ts"

/** The activator could not do it. */
export class ParkStuck extends NodeRun(ParkAlertCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ what: "Người kích hoạt chưa làm được", ref: s.deal.code, nextAction: "Xem lý do trong phòng, xử lý rồi báo lại" })
    override readonly into = ["alert"] as const
    override readonly next = Parked
}
