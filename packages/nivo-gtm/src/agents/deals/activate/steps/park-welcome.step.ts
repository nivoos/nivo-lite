import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { ParkAlert as ParkAlertCell } from "../../../../common/recover/park-alert.cell.ts"
import type { State } from "../activate.workflow.ts"
import { Parked } from "./parked.step.ts"

/** The channel refused the welcome (the deal is activated and the lead won). */
export class ParkWelcome extends NodeRun(ParkAlertCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ what: "Không gửi được lời chào mừng: kênh từ chối", ref: s.deal.code, nextAction: "Liên hệ khách bằng cách khác" })
    override readonly into = ["alert"] as const
    override readonly next = Parked
}
