import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { refOf } from "../common/helpers.ts"
import { Publication } from "../../../objects/publication.object.ts"
import { keyOf } from "../../../package-key.ts"

export const RecordInput = z.strictObject({
    publicationId: z.string().max(80).min(1),
    url: z.string().max(500),
    ref: z.string().max(80),
})
export const RecordOutput = z.strictObject({ publicationId: z.string().max(80), recorded: z.literal(true) })

type In = z.infer<typeof RecordInput>
type Out = z.infer<typeof RecordOutput>

/**
 * `nivo-gtm.social-record` (Ghi lượt đăng đã đăng): one act, `object.update` of the publication to `published` with its link and the channel's message id as evidence; its next action is cleared.
 */
export class SocialRecord implements Node<typeof RecordInput, typeof RecordOutput> {
    readonly key = keyOf("social-record")
    readonly version = 1
    readonly title = { vi: "Ghi lượt đăng đã đăng", en: "Record the publication" }
    readonly input = RecordInput
    readonly output = RecordOutput
    readonly reads = ["object.get"]
    readonly mutation = "object.update"

    run(input: In, reach: NodeReach): Out {
        const got = reach.objects(Publication).get(refOf<Publication>(input.publicationId))
        if (got.error) throw got.error
        const { error } = reach.objects(Publication).update({
            id: got.result.id,
            version: got.result.version,
            values: {
                status: "published",
                ...(input.url === "" ? {} : { url: input.url }),
                evidence: `telegram message ${input.ref}`,
                nextAction: null,
                nextAt: null,
            },
        })
        if (error) throw error
        return { publicationId: input.publicationId, recorded: true }
    }
}
