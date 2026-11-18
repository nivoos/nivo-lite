import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import type { ContentPublished } from "../../../common/events/content-published.event.ts"
import { keyOf } from "../../../package-key.ts"

export const EmitPublishedInput = z.strictObject({
    publicationId: z.string().max(80).min(1),
    contentId: z.string().max(80).min(1),
    channel: z.string().min(1).max(20),
})
export const EmitPublishedOutput = z.strictObject({ emitted: z.literal(true), key: z.string().max(80) })

type In = z.infer<typeof EmitPublishedInput>
type Out = z.infer<typeof EmitPublishedOutput>

/** `nivo-gtm.social-emit-published` (Báo bài đã đăng): one act, `events.emit` of `nivo-gtm.content.published` on the subject `publication:<id>`, keyed by the publication. */
export class SocialEmitPublished implements Node<typeof EmitPublishedInput, typeof EmitPublishedOutput> {
    readonly key = keyOf("social-emit-published")
    readonly version = 1
    readonly title = { vi: "Báo bài đã đăng", en: "Announce the published post" }
    readonly input = EmitPublishedInput
    readonly output = EmitPublishedOutput
    readonly reads = []
    readonly mutation = "events.emit"

    run(input: In, reach: NodeReach): Out {
        const key = `published:${input.publicationId}`
        const { error } = reach.emit<typeof ContentPublished>("nivo-gtm.content.published", {
            subject: { kind: "publication", id: input.publicationId },
            data: input,
            key,
        })
        if (error) throw error
        return { emitted: true, key }
    }
}
