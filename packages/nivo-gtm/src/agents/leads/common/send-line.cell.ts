import { z } from "zod"
import type { ContactMessageSend, Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { chatIdOf } from "./lead-code.ts"

/** `to` is a Telegram chat id or a lead code (`tg-<id>`): a private chat has the person's id as its chat id. */
export const SendLineInput = z.strictObject({ to: z.string().min(1).max(200), text: z.string().min(1).max(2000) })
/** Nothing to report: a send that did not go out throws its declared refusal. */
export const SendLineOutput = z.strictObject({})

type In = z.infer<typeof SendLineInput>
type Out = z.infer<typeof SendLineOutput>

/**
 * Sends one customer line on Telegram: one act, `contact_message.send`. This is an outbound message, so the engine runs the step in `ask` mode (a person approves the words first) and the
 * workspace cannot switch it to `auto`. A held route (`route_held`) or an erased contact (`contact_erased`) is a declared refusal: the cell hands it up and the sending step routes it with `onRefused`.
 */
export class SendLine implements Node<typeof SendLineInput, typeof SendLineOutput> {
    readonly key = keyOf("leads-send-line")
    readonly version = 2
    readonly title = { vi: "Gửi tin Telegram cho khách", en: "Send the customer a Telegram line" }
    readonly input = SendLineInput
    readonly output = SendLineOutput
    readonly reads = []
    readonly mutation = "contact_message.send"

    run(input: In, reach: NodeReach): Out {
        const { error } = reach.call<ContactMessageSend>("contact_message.send", {
            provider: "telegram",
            to: chatIdOf(input.to),
            text: input.text,
        })
        if (error) throw error
        return {}
    }
}
