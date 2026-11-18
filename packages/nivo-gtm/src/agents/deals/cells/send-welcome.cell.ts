import { z } from "zod"
import type { ContactMessageSend, Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { SentOutput } from "./sent.ts"

export const SendWelcomeInput = z.strictObject({
    channel: z.string().min(1).max(20),
    to: z.string().min(1).max(200),
    leadName: z.string().max(120),
    plan: z.string().max(60),
})
export const SendWelcomeSettings = z.strictObject({
    welcome: z
        .string()
        .min(1)
        .max(500)
        .default(
            "NIVO đã kích hoạt gói cho bạn. Bạn đăng nhập, thêm đồng đội và giao việc đầu tiên cho agent nhé; có gì chưa rõ cứ nhắn lại ở đây.",
        ),
})

type In = z.infer<typeof SendWelcomeInput>
type Out = z.infer<typeof SentOutput>
type Settings = z.infer<typeof SendWelcomeSettings>

const welcomeText = (input: In, settings: Settings): string => {
    const hello = input.leadName === "" ? "Chào bạn" : `Chào ${input.leadName}`
    return `${hello}! Chào mừng bạn đến với NIVO, gói ${input.plan === "" ? "Vận hành" : input.plan}.
${settings.welcome}`
}

/** `nivo-gtm.send-welcome` (Gửi lời chào mừng): ONE act, `contact_message.send` of the welcome after activation. It leaves the company, so a person approves it (locked ask, G1). */
export class SendWelcome implements Node<typeof SendWelcomeInput, typeof SentOutput, typeof SendWelcomeSettings> {
    readonly key = keyOf("send-welcome")
    readonly version = 2
    readonly title = { vi: "Gửi lời chào mừng", en: "Send the welcome" }
    readonly input = SendWelcomeInput
    readonly output = SentOutput
    readonly settings = SendWelcomeSettings
    readonly reads = []
    readonly mutation = "contact_message.send"

    run(input: In, reach: NodeReach<Settings>): Out {
        const { error } = reach.call<ContactMessageSend>("contact_message.send", {
            provider: input.channel,
            to: input.to,
            text: welcomeText(input, reach.settings),
        })
        if (error) throw error
        return { channel: input.channel, to: input.to }
    }
}
