import { z } from "zod"
import type { Node, NodeReach, RoomMessagePost } from "@starci/nivoos-sdk"
import { money } from "../../../common/helpers/text.ts"
import { keyOf } from "../../../package-key.ts"

export const AskOwnerInput = z.strictObject({ code: z.string().min(1).max(40), discountPercent: z.number(), amount: z.number().int(), lines: z.string().max(600) })
export const AskOwnerOutput = z.strictObject({ messageId: z.string(), roomId: z.string() })
/** The member who decides a discount above the line (a member id); empty asks the whole room. */
export const AskOwnerSettings = z.strictObject({ owner: z.string().max(80).default("") })

type In = z.infer<typeof AskOwnerInput>
type Out = z.infer<typeof AskOwnerOutput>
type Settings = z.infer<typeof AskOwnerSettings>

/**
 * `nivo-gtm.ask-owner` (Hỏi chủ về giảm giá): one act, `room.message.post` of a card with the choices `ok` and `no` to the owner (the setting `owner`, else the room). Posted when a quote's discount is
 * above the line the owner set (`ownerApprovesAbove`); the quote is sent only after an `ok`.
 */
export class AskOwner implements Node<typeof AskOwnerInput, typeof AskOwnerOutput, typeof AskOwnerSettings> {
    readonly key = keyOf("ask-owner")
    readonly version = 1
    readonly title = { vi: "Hỏi chủ về giảm giá", en: "Ask the owner about the discount" }
    readonly input = AskOwnerInput
    readonly output = AskOwnerOutput
    readonly settings = AskOwnerSettings
    readonly reads = []
    readonly mutation = "room.message.post"

    run(input: In, reach: NodeReach<Settings>): Out {
        const text = `Đơn ${input.code} xin giảm ${String(input.discountPercent)}%, tổng ${money(input.amount)}. Chủ duyệt mức này?\n${input.lines}`
        const { result, error } = reach.call<RoomMessagePost>("room.message.post", {
            text,
            choices: [
                { value: "ok", label: "Đồng ý giảm" },
                { value: "no", label: "Không giảm" },
            ],
            ...(reach.settings.owner === "" ? {} : { audience: [reach.settings.owner] }),
        })
        if (error) throw error
        return { messageId: result.messageId, roomId: result.roomId }
    }
}
