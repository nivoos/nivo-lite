import { z } from "zod"
import type { ContactMessageSend, Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { isPending } from "../providers/pending-channels.ts"

export const SendInput = z.strictObject({ channel: z.string().min(1).max(20), text: z.string().min(1).max(4000) })
/** `sent` false: nothing went out; `refusal` says why (`channel_pending` for a channel with no provider yet, `channel_not_set` when the channel chat is not set, else the provider's code). */
export const SendOutput = z.strictObject({ sent: z.boolean(), refusal: z.string().max(80), ref: z.string().max(80), url: z.string().max(500) })
/** The NIVO Telegram channel: its chat id or `@username` (empty until the owner sets it). */
export const SendSettings = z.strictObject({ telegramChannelChatId: z.string().max(100).default("") })

type In = z.infer<typeof SendInput>
type Out = z.infer<typeof SendOutput>
type Settings = z.infer<typeof SendSettings>

/**
 * `nivo-gtm.social-send` (Đăng bài): the ONE act that leaves the company, `contact_message.send` (the engine act that sends a line through the Telegram provider, `telegram.messages.send`) to the NIVO channel. The workflow runs it in `ask` mode, so a person approves every post before it
 * goes out (and the engine keeps it locked there). A channel with no provider yet (Facebook, TikTok, YouTube: `PENDING_CHANNELS`) is the provider seam: nothing is called and the node says `channel_pending`.
 */
export class SocialSend implements Node<typeof SendInput, typeof SendOutput, typeof SendSettings> {
    readonly key = keyOf("social-send")
    readonly version = 1
    readonly title = { vi: "Đăng bài lên kênh", en: "Publish to the channel" }
    readonly input = SendInput
    readonly output = SendOutput
    readonly settings = SendSettings
    readonly reads = []
    readonly mutation = "contact_message.send"

    run(input: In, reach: NodeReach<Settings>): Out {
        if (isPending(input.channel)) return { sent: false, refusal: "channel_pending", ref: "", url: "" }
        if (input.channel !== "telegram" || reach.settings.telegramChannelChatId === "") return { sent: false, refusal: "channel_not_set", ref: "", url: "" }
        const chatId = reach.settings.telegramChannelChatId
        const { result, error } = reach.call<ContactMessageSend>("contact_message.send", { provider: "telegram", to: chatId, text: input.text })
        if (error) return { sent: false, refusal: error.code, ref: "", url: "" }
        return { sent: true, refusal: "", ref: result.messageId ?? "", url: chatId.startsWith("@") && result.messageId !== null ? `https://t.me/${chatId.slice(1)}/${result.messageId}` : "" }
    }
}
