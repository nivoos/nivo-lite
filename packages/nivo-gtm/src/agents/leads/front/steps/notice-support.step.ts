import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { PostNotice as PostNoticeCell } from "../../common/post-notice.cell.ts"
import type { State } from "../front.workflow.ts"
import { EndSupport } from "./end-support.step.ts"

/** Runs `PostNotice` (tells the sales team: one act, `room.message.post` of the heading and the words to the agent's team room (an internal message: nothing leaves the company)) and keeps its result in `notice`; the run then goes to `EndSupport`. */
export class NoticeSupport extends NodeRun(PostNoticeCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        title: "Khách đang dùng NIVO cần hỗ trợ",
        text: s.understood.summary,
    })
    override readonly into = ["notice"] as const
    override readonly next = EndSupport
}
