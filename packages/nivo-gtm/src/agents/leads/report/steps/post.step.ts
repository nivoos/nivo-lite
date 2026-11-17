import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { PostNotice as PostNoticeCell } from "../../common/post-notice.cell.ts"
import type { State } from "../report.workflow.ts"
import { EndReported } from "./end-reported.step.ts"

export class Post extends NodeRun(PostNoticeCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ title: "Báo cáo chăm khách cuối ngày", text: s.report.text })
    override readonly into = ["posted"] as const
    override readonly next = EndReported
}
