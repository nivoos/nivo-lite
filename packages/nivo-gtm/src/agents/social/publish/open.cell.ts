import { z } from "zod"
import type { NivoRef, Node, NodeReach } from "@starci/nivoos-sdk"
import { Content } from "../../../objects/content.object.ts"
import { Publication } from "../../../objects/publication.object.ts"
import { keyOf } from "../../../package-key.ts"

export const OpenInput = z.strictObject({ objectId: z.string().min(1) })
export const OpenOutput = z.strictObject({
    publicationId: z.string(),
    contentId: z.string(),
    contentCode: z.string().max(40),
    channel: z.string().max(20),
    at: z.string().min(10),
    status: z.string().max(20),
    text: z.string().max(4000),
})

type In = z.infer<typeof OpenInput>
type Out = z.infer<typeof OpenOutput>

/**
 * `nivo-gtm.social-publish-open` (Mở lượt đăng): a decision node. It reads the publication and its content item: the channel, the time it goes out, its current status and the words to publish (the caption, else the title).
 * It runs again when a person moves the time, so the wait that follows always uses the newest time.
 */
export class SocialPublishOpen implements Node<typeof OpenInput, typeof OpenOutput> {
    readonly key = keyOf("social-publish-open")
    readonly version = 1
    readonly title = { vi: "Mở lượt đăng", en: "Open the publication" }
    readonly input = OpenInput
    readonly output = OpenOutput
    readonly reads = ["object.get"]

    run(input: In, reach: NodeReach): Out {
        const pub = reach.objects(Publication).get(input.objectId as NivoRef<Publication>)
        if (pub.error) throw pub.error
        const content = reach.objects(Content).get(String(pub.result.values.content) as NivoRef<Content>)
        if (content.error) throw content.error
        const values = content.result.values
        return {
            publicationId: input.objectId,
            contentId: String(content.result.id),
            contentCode: values.code,
            channel: pub.result.values.channel,
            at: pub.result.values.at ?? reach.facts.at,
            status: pub.result.values.status,
            text: (values.caption ?? values.title).slice(0, 4000),
        }
    }
}
