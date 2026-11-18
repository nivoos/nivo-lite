import { z } from "zod"
import type { Node, NodeReach, RoomMessagePost } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { Choice } from "./social.shapes.ts"

export const AskTeamInput = z.strictObject({
    text: z.string().min(1).max(3000),
    choices: z.array(Choice).max(6).optional(),
})
export const AskTeamOutput = z.strictObject({ messageId: z.string().max(80), roomId: z.string().max(80) })

type In = z.infer<typeof AskTeamInput>
type Out = z.infer<typeof AskTeamOutput>

/**
 * `nivo-gtm.social-ask-team` (Hỏi nhóm): one act, `room.message.post` to the room the workflow binds to the step. The business message of the Social agent to its team: a question with choices (the answer comes back as
 * `engine.room.answered`), its nudge, a complaint notice or the weekly report. Internal: nothing leaves the company, so it runs `auto`.
 */
export class SocialAskTeam implements Node<typeof AskTeamInput, typeof AskTeamOutput> {
    readonly key = keyOf("social-ask-team")
    readonly version = 1
    readonly title = { vi: "Hỏi nhóm", en: "Ask the team" }
    readonly input = AskTeamInput
    readonly output = AskTeamOutput
    readonly reads = []
    readonly mutation = "room.message.post"

    run(input: In, reach: NodeReach): Out {
        const { result, error } = reach.call<RoomMessagePost>("room.message.post", {
            text: input.text,
            ...(input.choices === undefined ? {} : { choices: input.choices }),
        })
        if (error) throw error
        return { messageId: result.messageId, roomId: result.roomId }
    }
}
