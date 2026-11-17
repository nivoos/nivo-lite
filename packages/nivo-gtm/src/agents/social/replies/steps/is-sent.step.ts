import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import { Replied } from "./replied.step.ts"
import { NotSent } from "./not-sent.step.ts"
import type { State } from "../replies.workflow.ts"

export class IsSent extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.sent.sent === true
    override readonly label = { vi: "Đã gửi?", en: "Sent?" }
    override readonly yes = Replied
    override readonly no = NotSent
}
