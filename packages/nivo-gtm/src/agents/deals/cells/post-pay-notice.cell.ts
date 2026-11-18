import { z } from "zod"
import type { Node, NodeReach, RoomMessagePost } from "@starci/nivoos-sdk"
import { money } from "../../../common/helpers/text.ts"
import { keyOf } from "../../../package-key.ts"

export const PostPayNoticeInput = z.strictObject({
    code: z.string().min(1).max(40),
    /** `short`: a transfer with the right code but less money; `unpaid`: no money after the one reminder. */
    kind: z.enum(["short", "unpaid"]),
    amount: z.number(),
    /** What came in (0 when nothing did). */
    received: z.number(),
})
export const PostPayNoticeOutput = z.strictObject({ messageId: z.string().max(80), roomId: z.string().max(80) })

type In = z.infer<typeof PostPayNoticeInput>
type Out = z.infer<typeof PostPayNoticeOutput>

const noticeText = (input: In): string =>
    input.kind === "short"
        ? `Đơn ${input.code}: khách chuyển thiếu tiền (cần ${money(input.amount)}, nhận ${money(input.received)}). Liên hệ khách để chuyển bù, rồi chuyển đơn về accepted.`
        : `Đơn ${input.code}: hết hạn chờ thanh toán sau một lần nhắc (${money(input.amount)}). Gọi khách hỏi lý do; còn muốn mua thì chuyển đơn về accepted, không thì đánh dấu mất.`

/**
 * `nivo-gtm.post-pay-notice` (Báo phòng bán hàng về khoản thu): one act, `room.message.post` of a notice to the sales room when a payment ends `short` or `unpaid`, so a person calls the customer.
 * Internal: nothing leaves the company, so it runs `auto`.
 */
export class PostPayNotice implements Node<typeof PostPayNoticeInput, typeof PostPayNoticeOutput> {
    readonly key = keyOf("post-pay-notice")
    readonly version = 1
    readonly title = { vi: "Báo phòng bán hàng về khoản thu", en: "Tell the sales room about a payment" }
    readonly input = PostPayNoticeInput
    readonly output = PostPayNoticeOutput
    readonly reads = []
    readonly mutation = "room.message.post"

    run(input: In, reach: NodeReach): Out {
        const { result, error } = reach.call<RoomMessagePost>("room.message.post", { text: noticeText(input) })
        if (error) throw error
        return { messageId: result.messageId, roomId: result.roomId }
    }
}
