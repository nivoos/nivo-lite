import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioMarkParked as MarkParkedCell } from "../../common/mark-parked.cell.ts"
import { AlertPark } from "./alert-park.step.ts"
import type { State } from "../review-cut.workflow.ts"

export class MarkParked extends NodeRun(MarkParkedCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ objectId: s.cut.contentId, why: "Bản dựng chờ duyệt quá hạn: người phụ trách duyệt thủ công rồi đổi trạng thái sang approved (hoặc producing để sửa)" })
    override readonly into = ["marked"] as const
    override readonly next = AlertPark
}
