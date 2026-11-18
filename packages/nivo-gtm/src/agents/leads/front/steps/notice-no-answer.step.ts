import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { PostNotice as PostNoticeCell } from "../../common/post-notice.cell.ts"
import type { State } from "../front.workflow.ts"
import { EndNoAnswer } from "./end-no-answer.step.ts"

/** The public brain could not answer: the team is told the question to answer by hand and to add to the Second Brain. */
export class NoticeNoAnswer extends NodeRun(PostNoticeCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        title: "Thông tin công khai chưa trả lời được câu hỏi của khách",
        text: s.answer.question,
    })
    override readonly into = ["notice"] as const
    override readonly next = EndNoAnswer
}
