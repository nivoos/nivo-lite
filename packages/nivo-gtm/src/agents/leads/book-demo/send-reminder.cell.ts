import { z } from "zod"
import type { ContactMessageSend, Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { chatIdOf } from "../common/lead-code.ts"
import { SendLineOutput } from "../common/send-line.cell.ts"
import { SendConfirmInput } from "./send-confirm.cell.ts"

type In = z.infer<typeof SendConfirmInput>
type Out = z.infer<typeof SendLineOutput>

/** Reminds the lead of the demo shortly before it: one act, `contact_message.send` on Telegram, fixed words. The step runs in `ask` mode. */
export class SendReminder implements Node<typeof SendConfirmInput, typeof SendLineOutput> {
    readonly key = keyOf("leads-send-reminder")
    readonly version = 2
    readonly title = { vi: "Nhắc khách lịch demo", en: "Remind the lead of the demo" }
    readonly input = SendConfirmInput
    readonly output = SendLineOutput
    readonly reads = []
    readonly mutation = "contact_message.send"

    run(input: In, reach: NodeReach): Out {
        const where = input.link === "" ? "" : ` Link tham gia: ${input.link}`
        const text = `Dạ NIVO nhắc bạn: sắp đến giờ demo lúc ${input.label} (giờ Việt Nam).${where} Hẹn gặp bạn ạ!`
        const { error } = reach.call<ContactMessageSend>("contact_message.send", {
            provider: "telegram",
            to: chatIdOf(input.to),
            text,
        })
        if (error) throw error
        return {}
    }
}
