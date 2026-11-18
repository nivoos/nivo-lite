import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import type { ContentApproved } from "../../../common/events/content-approved.event.ts"
import { keyOf } from "../../../package-key.ts"

export const EmitApprovedInput = z.strictObject({ contentId: z.string().max(80).min(1), code: z.string().max(40) })
export const EmitApprovedOutput = z.strictObject({ emitted: z.literal(true), key: z.string().max(80) })

type In = z.infer<typeof EmitApprovedInput>
type Out = z.infer<typeof EmitApprovedOutput>

/**
 * `nivo-gtm.social-emit-approved` (Báo bài đã duyệt): one act, `events.emit` of `nivo-gtm.content.approved` on the subject `content:<id>`, keyed by the content and the transition, so a rerun writes nothing new.
 */
export class SocialEmitApproved implements Node<typeof EmitApprovedInput, typeof EmitApprovedOutput> {
    readonly key = keyOf("social-emit-approved")
    readonly version = 1
    readonly title = { vi: "Báo bài đã duyệt", en: "Announce the approved post" }
    readonly input = EmitApprovedInput
    readonly output = EmitApprovedOutput
    readonly reads = []
    readonly mutation = "events.emit"

    run(input: In, reach: NodeReach): Out {
        const key = `approved:${input.contentId}`
        const { error } = reach.emit<typeof ContentApproved>("nivo-gtm.content.approved", {
            subject: { kind: "content", id: input.contentId },
            data: { contentId: input.contentId, kind: "post" },
            key,
        })
        if (error) throw error
        return { emitted: true, key }
    }
}
