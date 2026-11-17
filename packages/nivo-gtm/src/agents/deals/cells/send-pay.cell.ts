import { z } from "zod"
import type { ContactMessageSend, Node, NodeReach } from "@starci/nivoos-sdk"
import { money } from "../../../common/helpers/text.ts"
import { keyOf } from "../../../package-key.ts"
import { SentOutput } from "./sent.ts"

export const SendPayInput = z.strictObject({
    channel: z.string().min(1).max(20),
    to: z.string().min(1).max(200),
    leadName: z.string().max(120),
    payCode: z.string().min(1).max(40),
    amount: z.number().int().min(0),
    /** `request` is the first message with the transfer details, `nudge` the reminder when no money came. */
    kind: z.enum(["request", "nudge"]),
})
export const SendPayOutput = SentOutput
/** NIVO's company bank account as the customer is told it (PLACEHOLDERS until the owner fills them; the SePay account in the workspace is the one that receives). */
export const SendPaySettings = z.strictObject({
    bankName: z.string().min(1).max(80).default("Ngân hàng (chờ NIVO cập nhật)"),
    accountNumber: z.string().min(1).max(40).default("(chờ NIVO cập nhật)"),
    accountName: z.string().min(1).max(120).default("CÔNG TY NIVO (chờ cập nhật)"),
})

type In = z.infer<typeof SendPayInput>
type Out = z.infer<typeof SendPayOutput>
type Settings = z.infer<typeof SendPaySettings>

const payText = (input: In, settings: Settings): string =>
    `${input.kind === "nudge" ? "NIVO nhắc nhẹ: chưa thấy khoản chuyển cho đơn của bạn.\n" : "Cảm ơn bạn đã đồng ý! Bạn chuyển khoản theo thông tin sau:\n"}` +
    `Ngân hàng: ${settings.bankName}\nSố tài khoản: ${settings.accountNumber}\nChủ tài khoản: ${settings.accountName}\n` +
    `Số tiền: ${money(input.amount)}\nNội dung chuyển khoản (giữ đúng để hệ thống tự nhận tiền): ${input.payCode}`

/**
 * `nivo-gtm.send-pay` (Gửi thông tin chuyển khoản): ONE act, `contact_message.send` with the amount, the account and the pay code the customer writes in the transfer memo (the `sepay.payment.paid` trigger
 * reads that code). It leaves the company, so a person approves it (locked ask, G1). Used for the first request and for the one reminder.
 */
export class SendPay implements Node<typeof SendPayInput, typeof SendPayOutput, typeof SendPaySettings> {
    readonly key = keyOf("send-pay")
    readonly version = 1
    readonly title = { vi: "Gửi thông tin chuyển khoản", en: "Send the payment details" }
    readonly input = SendPayInput
    readonly output = SendPayOutput
    readonly settings = SendPaySettings
    readonly reads = []
    readonly mutation = "contact_message.send"

    run(input: In, reach: NodeReach<Settings>): Out {
        const { error } = reach.call<ContactMessageSend>("contact_message.send", { provider: input.channel, to: input.to, text: payText(input, reach.settings) })
        if (error) return { sent: false, refusal: error.code }
        return { sent: true, refusal: "" }
    }
}
