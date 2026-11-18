import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { refOf } from "../common/helpers.ts"
import { Content } from "../../../objects/content.object.ts"
import { keyOf } from "../../../package-key.ts"

export const MarkContentInput = z.strictObject({ contentId: z.string().max(80).min(1) })
export const MarkContentOutput = z.strictObject({ contentId: z.string().max(80), published: z.literal(true) })

type In = z.infer<typeof MarkContentInput>
type Out = z.infer<typeof MarkContentOutput>

/** `nivo-gtm.social-mark-content-published` (Đánh dấu nội dung đã đăng): one act, `object.update` of the content item to `published`. */
export class SocialMarkContentPublished implements Node<typeof MarkContentInput, typeof MarkContentOutput> {
    readonly key = keyOf("social-mark-content-published")
    readonly version = 1
    readonly title = { vi: "Đánh dấu nội dung đã đăng", en: "Mark the content published" }
    readonly input = MarkContentInput
    readonly output = MarkContentOutput
    readonly reads = ["object.get"]
    readonly mutation = "object.update"

    run(input: In, reach: NodeReach): Out {
        const got = reach.objects(Content).get(refOf<Content>(input.contentId))
        if (got.error) throw got.error
        const { error } = reach.objects(Content).update({
            id: got.result.id,
            version: got.result.version,
            values: { status: "published", nextAction: null, nextAt: null },
        })
        if (error) throw error
        return { contentId: input.contentId, published: true }
    }
}
