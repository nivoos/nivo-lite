import { z } from "zod"
import type { ContactMessageSend, Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { chatIdOf } from "../common/lead-code.ts"
import { SendLineOutput } from "../common/send-line.cell.ts"

export const SendConfirmInput = z.strictObject({ to: z.string().min(1).max(200), label: z.string().min(1).max(40), link: z.string().max(500) })

type In = z.infer<typeof SendConfirmInput>
type Out = z.infer<typeof SendLineOutput>

/**
 * Confirms the booked demo to the lead: one act, `contact_message.send` on Telegram. The words are fixed (the time as the calendar holds it, the link when there is one, otherwise a promise to send
 * it before the time). The step runs in `ask` mode.
 */
export class SendConfirm implements Node<typeof SendConfirmInput, typeof SendLineOutput> {
    readonly key = keyOf("leads-send-confirm")
    readonly version = 1
    readonly title = { vi: "Xác nhận lịch demo với khách", en: "Confirm the demo to the lead" }
    readonly input = SendConfirmInput
    readonly output = SendLineOutput
    readonly reads = []
    readonly mutation = "contact_message.send"

    run(input: In, reach: NodeReach): Out {
        const where = input.link === "" ? "Bên mình sẽ gửi link tham gia trước giờ hẹn." : `Link tham gia: ${input.link}`
        const text = `Dạ NIVO xác nhận lịch demo của bạn: ${input.label} (giờ Việt Nam). ${where} Hẹn gặp bạn ạ!`
        const { error } = reach.call<ContactMessageSend>("contact_message.send", { provider: "telegram", to: chatIdOf(input.to), text })
        if (error) return { sent: false, refusal: error.code }
        return { sent: true, refusal: "" }
    }
}
