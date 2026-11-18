import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { Content } from "../../../objects/content.object.ts"
import { keyOf } from "../../../package-key.ts"
import type { BrainSearch } from "../common/callees.ts"
import { clip, refOf } from "../common/helpers.ts"

export const ReadInput = z.strictObject({ objectId: z.string().max(80).min(1) })
export const ReadOutput = z.strictObject({
    objectId: z.string().max(80),
    code: z.string().max(40),
    title: z.string().max(200),
    pillar: z.string().max(120),
    hook: z.string().max(300),
    brain: z.array(z.string().max(1200)).max(16),
})
/** How much of the brain a draft reads per question. */
export const ReadSettings = z.strictObject({ brainHits: z.number().int().min(1).max(8).default(4) })

type In = z.infer<typeof ReadInput>
type Out = z.infer<typeof ReadOutput>
type Settings = z.infer<typeof ReadSettings>

/** The questions a post draft asks the brain: the facts it may state (public), then the voice (internal). */
const QUESTIONS = ["what NIVO is, its features and prices", "brand voice, words to use and avoid"]

/**
 * `nivo-gtm.social-draft-read` (Đọc ý tưởng bài đăng): a decision node. It reads the chosen idea and the brain (public product facts, the internal voice) the draft is written from.
 */
export class SocialDraftRead implements Node<typeof ReadInput, typeof ReadOutput, typeof ReadSettings> {
    readonly key = keyOf("social-draft-read")
    readonly version = 1
    readonly title = { vi: "Đọc ý tưởng bài đăng", en: "Read the post idea" }
    readonly input = ReadInput
    readonly output = ReadOutput
    readonly settings = ReadSettings
    readonly reads = ["object.get", "brain.search"]

    run(input: In, reach: NodeReach<Settings>): Out {
        const got = reach.objects(Content).get(refOf<Content>(input.objectId))
        if (got.error) throw got.error
        const brain: Array<string> = []
        for (const query of QUESTIONS) {
            const { result } = reach.call<BrainSearch>("brain.search", { query, limit: reach.settings.brainHits })
            for (const hit of result.hits) brain.push(clip(JSON.stringify(hit.passage ?? hit.truth), 1200))
        }
        const values = got.result.values
        return {
            objectId: input.objectId,
            code: values.code,
            title: values.title,
            pillar: values.pillar ?? "",
            hook: values.hook ?? "",
            brain,
        }
    }
}
