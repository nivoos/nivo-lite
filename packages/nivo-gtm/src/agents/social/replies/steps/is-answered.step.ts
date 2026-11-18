import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import { SendReply } from "./send-reply.step.ts"
import { Unanswered } from "./unanswered.step.ts"
import type { State } from "../replies.workflow.ts"

/** Branch: did the model find a public answer. */
export class IsAnswered extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.answer.answered === true
    override readonly label = { vi: "Có câu trả lời công khai?", en: "A public answer?" }
    override readonly yes = SendReply
    override readonly no = Unanswered
}
