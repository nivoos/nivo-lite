import { z } from "zod"
import type { Node, NodeReach, RoomMessagePost } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"

export const PostBriefInput = z.strictObject({
    code: z.string().min(1).max(40),
    owner: z.string().max(80),
    leadName: z.string().max(120),
    summary: z.string().max(900),
    objections: z.string().max(500),
    suggestedPlan: z.string().max(60),
})
export const PostBriefOutput = z.strictObject({ messageId: z.string().max(80), roomId: z.string().max(80) })
/** How long the sales person has to answer the brief card before the deal waits in proposal (the wait of the hand-over workflow reads it). */
export const PostBriefSettings = z.strictObject({ answerHours: z.number().int().min(1).max(720).default(24) })

type In = z.infer<typeof PostBriefInput>
type Out = z.infer<typeof PostBriefOutput>
type Settings = z.infer<typeof PostBriefSettings>

const briefText = (input: In): string => {
    const leadPart = input.leadName === "" ? "" : ` (${input.leadName})`
    const objectionsPart =
        input.objections === ""
            ? ""
            : `Điều khách còn băn khoăn: ${input.objections}
`
    return (
        `Bàn giao sau demo: đơn ${input.code}${leadPart}
` +
        `Người bán: ${input.owner === "" ? "chưa giao" : input.owner}
` +
        `${input.summary}
` +
        objectionsPart +
        `Gói đề xuất: ${input.suggestedPlan === "" ? "Vận hành" : input.suggestedPlan}
Báo giá ngay hay để sau?`
    )
}

/**
 * `nivo-gtm.post-brief` (Đăng bàn giao lên phòng bán hàng): one act, `room.message.post` of the brief with two choices, `quote` (Báo giá) and `hold` (Để sau). Internal: the card is to the sales team, so it
 * runs `auto`. The answer comes back to the run as `engine.room.answered`.
 */
export class PostBrief implements Node<typeof PostBriefInput, typeof PostBriefOutput, typeof PostBriefSettings> {
    readonly key = keyOf("post-brief")
    readonly version = 2
    readonly title = { vi: "Đăng bàn giao lên phòng bán hàng", en: "Post the hand-over to the sales room" }
    readonly input = PostBriefInput
    readonly output = PostBriefOutput
    readonly settings = PostBriefSettings
    readonly reads = []
    readonly mutation = "room.message.post"

    run(input: In, reach: NodeReach<Settings>): Out {
        const { result, error } = reach.call<RoomMessagePost>("room.message.post", {
            text: briefText(input),
            choices: [
                { value: "quote", label: "Báo giá" },
                { value: "hold", label: "Để sau" },
            ],
        })
        if (error) throw error
        return { messageId: result.messageId, roomId: result.roomId }
    }
}
