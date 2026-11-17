import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import { RecordSent } from "./record-sent.step.ts"
import { IsChannelPending } from "./is-channel-pending.step.ts"
import type { State } from "../publish.workflow.ts"

export class IsSent extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.sent.outcome === "sent"
    override readonly label = { vi: "Đã đăng?", en: "Sent?" }
    override readonly yes = RecordSent
    override readonly no = IsChannelPending
}
