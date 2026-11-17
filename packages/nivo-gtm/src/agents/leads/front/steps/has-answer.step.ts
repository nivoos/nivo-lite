import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../front.workflow.ts"
import { SendAnswer } from "./send-answer.step.ts"
import { NoticeNoAnswer } from "./notice-no-answer.step.ts"

export class HasAnswer extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.answer.answered === true
    override readonly yes = SendAnswer
    override readonly no = NoticeNoAnswer
}
