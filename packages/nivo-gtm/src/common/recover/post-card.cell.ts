import { z } from "zod"
import type { Node, NodeReach, RoomMessagePost } from "@starci/nivoos-sdk"
import { keyOf } from "../../package-key.ts"

export const PostCardInput = z.strictObject({
    text: z.string().min(1).max(3000),
    choices: z.array(z.strictObject({ value: z.string().min(1).max(60), label: z.string().min(1).max(60) })).max(6).optional(),
    audience: z.array(z.string().min(1).max(80)).max(20).optional(),
})
export const PostCardOutput = z.strictObject({ messageId: z.string(), roomId: z.string() })

type In = z.infer<typeof PostCardInput>
type Out = z.infer<typeof PostCardOutput>

/**
 * `nivo-gtm.post-card` (Đăng thẻ lên phòng): one act, `room.message.post` to the room the workflow binds to the step. The shared card of the package: a notice, a question with choices
 * (the answer comes back as `engine.room.answered`), or an alert. Internal: nothing leaves the company, so it runs `auto`.
 */
export class PostCard implements Node<typeof PostCardInput, typeof PostCardOutput> {
    readonly key = keyOf("post-card")
    readonly version = 1
    readonly title = { vi: "Đăng thẻ lên phòng", en: "Post a card to the room" }
    readonly input = PostCardInput
    readonly output = PostCardOutput
    readonly reads = []
    readonly mutation = "room.message.post"

    run(input: In, reach: NodeReach): Out {
        const { result, error } = reach.call<RoomMessagePost>("room.message.post", {
            text: input.text,
            ...(input.choices === undefined ? {} : { choices: input.choices }),
            ...(input.audience === undefined || input.audience.length === 0 ? {} : { audience: input.audience }),
        })
        if (error) throw error
        return { messageId: result.messageId, roomId: result.roomId }
    }
}
