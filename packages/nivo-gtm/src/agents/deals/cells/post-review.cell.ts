import { z } from "zod"
import type { Node, NodeReach, RoomMessagePost } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"

export const PostReviewInput = z.strictObject({ text: z.string().min(1).max(3000) })
export const PostReviewOutput = z.strictObject({ messageId: z.string().max(80), roomId: z.string().max(80) })

type In = z.infer<typeof PostReviewInput>
type Out = z.infer<typeof PostReviewOutput>

/** `nivo-gtm.post-review` (Đăng tổng kết đơn mất): one act, `room.message.post` of the Friday review to the sales room. Internal: nothing leaves the company, so it runs `auto`. */
export class PostReview implements Node<typeof PostReviewInput, typeof PostReviewOutput> {
    readonly key = keyOf("post-review")
    readonly version = 1
    readonly title = { vi: "Đăng tổng kết đơn mất", en: "Post the lost-deals review" }
    readonly input = PostReviewInput
    readonly output = PostReviewOutput
    readonly reads = []
    readonly mutation = "room.message.post"

    run(input: In, reach: NodeReach): Out {
        const { result, error } = reach.call<RoomMessagePost>("room.message.post", { text: input.text })
        if (error) throw error
        return { messageId: result.messageId, roomId: result.roomId }
    }
}
