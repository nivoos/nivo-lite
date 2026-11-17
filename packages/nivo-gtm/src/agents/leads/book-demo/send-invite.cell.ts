import { z } from "zod"
import type { ContactMessageSend, Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { chatIdOf } from "../common/lead-code.ts"
import { SendLineOutput } from "../common/send-line.cell.ts"

export const SendInviteInput = z.strictObject({ to: z.string().min(1).max(200), name: z.string().max(120), labels: z.array(z.string().min(1).max(40)).min(1).max(10) })

type In = z.infer<typeof SendInviteInput>
type Out = z.infer<typeof SendLineOutput>

/**
 * Invites the lead to choose a demo time: one act, `contact_message.send` on Telegram. The words are fixed here (the greeting, the numbered free times, how to answer): a model never retypes a
 * time, so a slot is always one the calendar really holds. The step runs in `ask` mode: a person approves the invitation before it goes.
 */
export class SendInvite implements Node<typeof SendInviteInput, typeof SendLineOutput> {
    readonly key = keyOf("leads-send-invite")
    readonly version = 2
    readonly title = { vi: "Mời khách chọn giờ demo", en: "Invite the lead to choose a demo time" }
    readonly input = SendInviteInput
    readonly output = SendLineOutput
    readonly reads = []
    readonly mutation = "contact_message.send"

    run(input: In, reach: NodeReach): Out {
        const hello = input.name === "" ? "Dạ chào bạn" : `Dạ chào ${input.name}`
        const lines = input.labels.map((label, index) => `${index + 1}. ${label}`).join("\n")
        const text = `${hello}, NIVO xin mời bạn xem demo. Bạn chọn giúp một khung giờ phù hợp:\n${lines}\nBạn nhắn số hoặc giờ bạn chọn, và cho mình email nếu muốn nhận thư xác nhận nhé.`
        const { error } = reach.call<ContactMessageSend>("contact_message.send", { provider: "telegram", to: chatIdOf(input.to), text })
        if (error) throw error
        return {}
    }
}
