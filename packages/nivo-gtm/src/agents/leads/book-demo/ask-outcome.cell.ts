import { z } from "zod"
import type { Node, NodeReach, RoomMessagePost } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"

export const AskOutcomeInput = z.strictObject({ name: z.string().max(120), label: z.string().min(1).max(40), host: z.string().max(80) })
export const AskOutcomeOutput = z.strictObject({ messageId: z.string(), roomId: z.string() })

type In = z.infer<typeof AskOutcomeInput>
type Out = z.infer<typeof AskOutcomeOutput>

/**
 * Asks the demo host how it went: one act, `room.message.post` with three choices (`done`, `no_show`, `moved`). The answer comes back as `engine.room.answered` on this run, so the workflow waits on
 * it. Internal, so it needs no approval.
 */
export class AskOutcome implements Node<typeof AskOutcomeInput, typeof AskOutcomeOutput> {
    readonly key = keyOf("leads-ask-outcome")
    readonly version = 1
    readonly title = { vi: "Hỏi kết quả buổi demo", en: "Ask how the demo went" }
    readonly input = AskOutcomeInput
    readonly output = AskOutcomeOutput
    readonly reads = []
    readonly mutation = "room.message.post"

    run(input: In, reach: NodeReach): Out {
        const who = input.name === "" ? "khách" : input.name
        const choices = [
            { value: "done", label: "Đã demo" },
            { value: "no_show", label: "Khách vắng" },
            { value: "moved", label: "Dời lịch" },
        ]
        const text = `Buổi demo với ${who} lúc ${input.label} đã diễn ra thế nào?`
        const { result, error } = reach.call<RoomMessagePost>("room.message.post", { text, choices, audience: input.host === "" ? "all" : [input.host] })
        if (error) throw error
        return { messageId: result.messageId, roomId: result.roomId }
    }
}
