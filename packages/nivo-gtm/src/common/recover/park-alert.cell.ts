import { z } from "zod"
import type { Node, NodeReach, RoomMessagePost } from "@starci/nivoos-sdk"
import { keyOf } from "../../package-key.ts"

export const ParkAlertInput = z.strictObject({
    /** What stopped, in the team's words (a short Vietnamese phrase). */
    what: z.string().min(1).max(200),
    /** The code of the object that is parked (a deal code, a content code). */
    ref: z.string().min(1).max(60),
    /** What a person does next to wake it. */
    nextAction: z.string().min(1).max(300),
})
export const ParkAlertOutput = z.strictObject({ messageId: z.string(), roomId: z.string() })

type In = z.infer<typeof ParkAlertInput>
type Out = z.infer<typeof ParkAlertOutput>

const alertText = (input: In): string => `Dừng lại: ${input.what}\nMã: ${input.ref}\nViệc cần làm: ${input.nextAction}`

/**
 * `nivo-gtm.park-alert` (Báo việc bị dừng): the park half of the recovery rule. A workflow that gave up (a refusal it cannot handle, a deadline that passed twice) posts ONE alert card to the
 * team room (`room.message.post` is an outbox write, so the card is not lost) and ends `parked`; the object it works on keeps its `nextAction`, and a person re-arms it by moving its status back.
 */
export class ParkAlert implements Node<typeof ParkAlertInput, typeof ParkAlertOutput> {
    readonly key = keyOf("park-alert")
    readonly version = 1
    readonly title = { vi: "Báo việc bị dừng", en: "Alert a parked item" }
    readonly input = ParkAlertInput
    readonly output = ParkAlertOutput
    readonly reads = []
    readonly mutation = "room.message.post"

    run(input: In, reach: NodeReach): Out {
        const { result, error } = reach.call<RoomMessagePost>("room.message.post", { text: alertText(input) })
        if (error) throw error
        return { messageId: result.messageId, roomId: result.roomId }
    }
}
