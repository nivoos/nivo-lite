import { z } from "zod"
import type { Node, NodeReach, RoomMessagePost } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { Choice } from "./studio.shapes.ts"

export const AskTeamInput = z.strictObject({
    text: z.string().min(1).max(3000),
    choices: z.array(Choice).max(6).optional(),
})
export const AskTeamOutput = z.strictObject({ messageId: z.string(), roomId: z.string() })

type In = z.infer<typeof AskTeamInput>
type Out = z.infer<typeof AskTeamOutput>

/**
 * `nivo-gtm.studio-ask-team` (Hỏi hoặc báo đội video): one act, `room.message.post` to the team room: the Studio agent's question with choices (the ideas, the script, the cut: the answer comes back as
 * `engine.room.answered`) or a plain notice to the person who shoots (the brief, the reminder, the overdue notice). Internal: nothing leaves the company, so it runs `auto`.
 */
export class StudioAskTeam implements Node<typeof AskTeamInput, typeof AskTeamOutput> {
    readonly key = keyOf("studio-ask-team")
    readonly version = 1
    readonly title = { vi: "Hỏi hoặc báo đội video", en: "Ask or tell the video team" }
    readonly input = AskTeamInput
    readonly output = AskTeamOutput
    readonly reads = []
    readonly mutation = "room.message.post"

    run(input: In, reach: NodeReach): Out {
        const { result, error } = reach.call<RoomMessagePost>("room.message.post", { text: input.text, ...(input.choices === undefined ? {} : { choices: input.choices }) })
        if (error) throw error
        return { messageId: result.messageId, roomId: result.roomId }
    }
}
