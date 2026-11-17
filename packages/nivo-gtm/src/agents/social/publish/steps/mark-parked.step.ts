import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialMarkParked as MarkParkedCell } from "../../common/mark-parked.cell.ts"
import { AlertPark } from "./alert-park.step.ts"
import type { State } from "../publish.workflow.ts"

export class MarkParked extends NodeRun(MarkParkedCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ type: "publication" as const, objectId: s.hear.objectId, why: "Chưa đăng được (chờ kết nối hoặc bị từ chối): xem thẻ cảnh báo rồi chuyển trạng thái về scheduled" })
    override readonly into = ["marked"] as const
    override readonly next = AlertPark
}
