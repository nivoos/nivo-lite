import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import type { ContentApproved } from "../../../common/events/content-approved.event.ts"
import { keyOf } from "../../../package-key.ts"

export const EmitApprovedInput = z.strictObject({
    contentId: z.string().min(1).max(100),
    kind: z.string().min(1).max(40),
})
export const EmitApprovedOutput = z.strictObject({ eventKey: z.string().max(200) })

type In = z.infer<typeof EmitApprovedInput>
type Out = z.infer<typeof EmitApprovedOutput>

/**
 * `nivo-gtm.studio-emit-approved` (Báo nội dung đã duyệt): one act, `events.emit` of `nivo-gtm.content.approved` on the subject `content:<id>`, keyed by the item, so a rerun writes nothing new. The Social agent's calendar
 * plans the item on it. The approval of the asset is the person's Duyệt; publishing is approved again per channel.
 */
export class StudioEmitApproved implements Node<typeof EmitApprovedInput, typeof EmitApprovedOutput> {
    readonly key = keyOf("studio-emit-approved")
    readonly version = 1
    readonly title = { vi: "Báo nội dung đã duyệt", en: "Announce the approved content" }
    readonly input = EmitApprovedInput
    readonly output = EmitApprovedOutput
    readonly reads = []
    readonly mutation = "events.emit"

    run(input: In, reach: NodeReach): Out {
        const key = `approved:${input.contentId}`
        const { error } = reach.emit<typeof ContentApproved>("nivo-gtm.content.approved", {
            subject: { kind: "content", id: input.contentId },
            data: { contentId: input.contentId, kind: input.kind },
            key,
        })
        if (error) throw error
        return { eventKey: key }
    }
}
