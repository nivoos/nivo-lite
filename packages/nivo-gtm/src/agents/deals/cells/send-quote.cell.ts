import { z } from "zod"
import type { ContactMessageSend, Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { SentOutput } from "./sent.ts"

export const SendQuoteInput = z.strictObject({
    channel: z.string().min(1).max(20),
    to: z.string().min(1).max(200),
    leadName: z.string().max(120),
    code: z.string().min(1).max(40),
    lines: z.string().min(1).max(600),
    trialDays: z.number().int().min(0).max(60),
})
export const SendQuoteOutput = SentOutput
/** The words of the quote around the figures; per-customer, with a default. */
export const SendQuoteSettings = z.strictObject({
    greeting: z.string().min(1).max(200).default("Cảm ơn bạn đã dành thời gian xem NIVO. Đây là báo giá của NIVO cho bạn:"),
    closing: z.string().min(1).max(300).default("Nếu bạn đồng ý, hãy nhắn lại để NIVO gửi mã chuyển khoản."),
})

type In = z.infer<typeof SendQuoteInput>
type Out = z.infer<typeof SendQuoteOutput>
type Settings = z.infer<typeof SendQuoteSettings>

const quoteText = (input: In, settings: Settings): string =>
    `${input.leadName === "" ? "Chào bạn" : `Chào ${input.leadName}`}, ${settings.greeting}\n\nBáo giá ${input.code}\n${input.lines}\n${input.trialDays > 0 ? `Bạn được dùng thử ${String(input.trialDays)} ngày trước khi trả tiền.\n` : ""}\n${settings.closing}`

/**
 * `nivo-gtm.send-quote` (Gửi báo giá): ONE act, `contact_message.send` of the quote to the lead on the channel they came from. The figures are the ones the `price` cell computed from the price-list
 * settings; nothing here changes a number. It leaves the company, so the engine holds it for a person's approval (locked ask, G1). A refusal of the channel is handed up for the step to route.
 */
export class SendQuote implements Node<typeof SendQuoteInput, typeof SendQuoteOutput, typeof SendQuoteSettings> {
    readonly key = keyOf("send-quote")
    readonly version = 2
    readonly title = { vi: "Gửi báo giá cho khách", en: "Send the quote to the customer" }
    readonly input = SendQuoteInput
    readonly output = SendQuoteOutput
    readonly settings = SendQuoteSettings
    readonly reads = []
    readonly mutation = "contact_message.send"

    run(input: In, reach: NodeReach<Settings>): Out {
        const { error } = reach.call<ContactMessageSend>("contact_message.send", { provider: input.channel, to: input.to, text: quoteText(input, reach.settings) })
        if (error) throw error
        return { channel: input.channel, to: input.to }
    }
}
