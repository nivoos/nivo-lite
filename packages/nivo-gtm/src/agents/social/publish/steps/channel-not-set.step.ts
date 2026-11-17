import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../publish.workflow.ts"

/** The Telegram channel chat is not set in the settings: nothing was sent. */
export class ChannelNotSet extends NodeEnd<typeof State> {
    override readonly reason = "channel_not_set"
}
