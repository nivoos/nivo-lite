import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import { ChannelPending } from "./channel-pending.step.ts"
import { ChannelNotSet } from "./channel-not-set.step.ts"
import type { State } from "../publish.workflow.ts"

/** Branch: was nothing sent because the channel has no provider yet, or because its chat is not set. */
export class IsChannelPending extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.sent.outcome === "channel_pending"
    override readonly label = { vi: "Kênh chờ kết nối?", en: "Channel not connected yet?" }
    override readonly yes = ChannelPending
    override readonly no = ChannelNotSet
}
