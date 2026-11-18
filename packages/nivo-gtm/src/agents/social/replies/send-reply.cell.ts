import { z } from "zod"
import type { ContactMessageSend, Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"

export const SendReplyInput = z.strictObject({
    chatId: z.string().min(1).max(40),
    messageId: z.string().max(80).regex(/^\d+$/u),
    text: z.string().min(1).max(1000),
})
/** The reply that went out: the provider message id. */
export const SendReplyOutput = z.strictObject({ ref: z.string().max(80) })

type In = z.infer<typeof SendReplyInput>
type Out = z.infer<typeof SendReplyOutput>

/**
 * `nivo-gtm.social-send-reply` (Gửi trả lời bình luận): the ONE act that leaves the company here, `contact_message.send` through the Telegram provider into the chat the comment came from (a reply thread is a later item: the engine act carries no reply-to). A refusal is handed up to the engine. The workflow runs it in
 * `ask` mode: a person approves every public reply.
 */
export class SocialSendReply implements Node<typeof SendReplyInput, typeof SendReplyOutput> {
    readonly key = keyOf("social-send-reply")
    readonly version = 2
    readonly title = { vi: "Gửi trả lời bình luận", en: "Send the reply" }
    readonly input = SendReplyInput
    readonly output = SendReplyOutput
    readonly reads = []
    readonly mutation = "contact_message.send"

    run(input: In, reach: NodeReach): Out {
        const { result, error } = reach.call<ContactMessageSend>("contact_message.send", {
            provider: "telegram",
            to: input.chatId,
            text: input.text,
        })
        if (error) throw error
        return { ref: result.messageId ?? "" }
    }
}
