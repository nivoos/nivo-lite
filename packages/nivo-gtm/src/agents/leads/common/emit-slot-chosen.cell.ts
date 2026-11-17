import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { TelegramMessage } from "@starci/nivoos-provider-templates/telegram/telegram.provider.cell"
import type { SlotChosen } from "./slot-chosen.event.ts"
import { keyOf } from "../../../package-key.ts"

export const EmitSlotChosenInput = z.strictObject({
    leadId: z.string().min(1).max(80),
    code: z.string().min(1).max(60),
    messages: z.array(TelegramMessage).min(1).max(50),
    email: z.string().max(200),
})
export const EmitSlotChosenOutput = z.strictObject({ emitted: z.literal(true) })

type In = z.infer<typeof EmitSlotChosenInput>
type Out = z.infer<typeof EmitSlotChosenOutput>

/** Hands the lead's answer to the demo booking: one act, `events.emit` of `SlotChosen` with the words they wrote. The key is the first message, so a rerun writes nothing new. */
export class EmitSlotChosen implements Node<typeof EmitSlotChosenInput, typeof EmitSlotChosenOutput> {
    readonly key = keyOf("leads-emit-slot-chosen")
    readonly version = 1
    readonly title = { vi: "Chuyển giờ khách chọn sang đặt demo", en: "Hand the chosen time to the demo booking" }
    readonly input = EmitSlotChosenInput
    readonly output = EmitSlotChosenOutput
    readonly reads = []
    readonly mutation = "events.emit"

    run(input: In, reach: NodeReach): Out {
        const text = input.messages.map((message) => message.text).join("\n").slice(0, 500)
        const { error } = reach.emit<typeof SlotChosen>("nivo-gtm.lead.slot-chosen", {
            subject: { kind: "lead", id: input.code },
            data: { leadId: input.leadId, text, email: input.email },
            key: `${input.leadId}:slot:${input.messages[0]?.updateId ?? ""}`,
        })
        if (error) throw error
        return { emitted: true }
    }
}
