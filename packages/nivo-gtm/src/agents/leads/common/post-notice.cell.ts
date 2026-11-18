import { z } from "zod"
import type { Node, NodeReach, RoomMessagePost } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"

export const PostNoticeInput = z.strictObject({ title: z.string().min(1).max(200), text: z.string().min(1).max(2000) })
export const PostNoticeOutput = z.strictObject({ posted: z.literal(true), messageId: z.string().max(128) })

type In = z.infer<typeof PostNoticeInput>
type Out = z.infer<typeof PostNoticeOutput>

/** Tells the sales team: one act, `room.message.post` of the heading and the words to the agent's team room (an internal message: nothing leaves the company). */
export class PostNotice implements Node<typeof PostNoticeInput, typeof PostNoticeOutput> {
    readonly key = keyOf("leads-post-notice")
    readonly version = 1
    readonly title = { vi: "Báo đội bán hàng", en: "Tell the sales team" }
    readonly input = PostNoticeInput
    readonly output = PostNoticeOutput
    readonly reads = []
    readonly mutation = "room.message.post"

    run(input: In, reach: NodeReach): Out {
        const { result, error } = reach.call<RoomMessagePost>("room.message.post", {
            text: `${input.title}\n${input.text}`,
        })
        if (error) throw error
        return { posted: true, messageId: result.messageId }
    }
}
