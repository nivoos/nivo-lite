import { z } from "zod"
import type { Node, NodeReach, RoomMessagePost } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"

export const TellHostInput = z.strictObject({ name: z.string().max(120), label: z.string().min(1).max(40), link: z.string().max(500), host: z.string().max(80) })
export const TellHostOutput = z.strictObject({ posted: z.literal(true), messageId: z.string() })

type In = z.infer<typeof TellHostInput>
type Out = z.infer<typeof TellHostOutput>

/** Tells the demo host (or the whole team when no host is set): one act, `room.message.post` addressed to the host. Internal, so it needs no approval. */
export class TellHost implements Node<typeof TellHostInput, typeof TellHostOutput> {
    readonly key = keyOf("leads-tell-host")
    readonly version = 1
    readonly title = { vi: "Báo người chủ trì demo", en: "Tell the demo host" }
    readonly input = TellHostInput
    readonly output = TellHostOutput
    readonly reads = []
    readonly mutation = "room.message.post"

    run(input: In, reach: NodeReach): Out {
        const who = input.name === "" ? "một khách tiềm năng" : input.name
        const where = input.link === "" ? "chưa có link họp" : input.link
        const text = `Có lịch demo mới với ${who} lúc ${input.label} (giờ Việt Nam). Link: ${where}.`
        const { result, error } = reach.call<RoomMessagePost>("room.message.post", { text, audience: input.host === "" ? "all" : [input.host] })
        if (error) throw error
        return { posted: true, messageId: result.messageId }
    }
}
