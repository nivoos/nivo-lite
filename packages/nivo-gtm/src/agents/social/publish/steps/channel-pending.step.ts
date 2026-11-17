import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../publish.workflow.ts"

/** The channel has no provider yet (Facebook, TikTok, YouTube): nothing was sent. */
export class ChannelPending extends NodeEnd<typeof State> {
    override readonly reason = "channel_pending"
}
