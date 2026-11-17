import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioMarkParked as MarkParkedCell } from "../../common/mark-parked.cell.ts"
import { AlertPark } from "./alert-park.step.ts"
import type { State } from "../produce.workflow.ts"

export class MarkParked extends NodeRun(MarkParkedCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ objectId: s.change.objectId, why: "Quá hạn quay dựng: chuyển trạng thái về script_ok để chạy lại khâu này" })
    override readonly into = ["marked"] as const
    override readonly next = AlertPark
}
