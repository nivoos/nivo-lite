import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialMarkParked as MarkParkedCell } from "../../common/mark-parked.cell.ts"
import { AlertPark } from "./alert-park.step.ts"
import type { State } from "../post-draft.workflow.ts"

export class MarkParked extends NodeRun(MarkParkedCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ type: "content" as const, objectId: s.change.objectId, why: "Bài đăng chưa được duyệt: duyệt lại rồi chuyển trạng thái về chosen" })
    override readonly into = ["marked"] as const
    override readonly next = AlertPark
}
