import { refOf } from "../../../common/helpers/refs.ts"
import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { Content } from "../../../objects/content.object.ts"
import { keyOf } from "../../../package-key.ts"
import type { BrainSearch } from "../common/callees.ts"
import { clip, textOf } from "../common/helpers.ts"

export const ReadBriefInput = z.strictObject({ objectId: z.string().min(1).max(100) })
const Passage = z.strictObject({ query: z.string().max(120), text: z.string().max(1200) })
const Past = z.strictObject({ title: z.string().max(200), hook: z.string().max(400) })
export const ReadBriefOutput = z.strictObject({
    objectId: z.string().max(100),
    code: z.string().max(40),
    title: z.string().max(200),
    pillar: z.string().max(120),
    hook: z.string().max(300),
    brain: z.array(Passage).max(12),
    past: z.array(Past).max(3),
})
export const ReadBriefSettings = z.strictObject({
    brainHits: z.number().int().min(1).max(8).default(4),
    pastScripts: z.number().int().min(0).max(3).default(3),
})

type In = z.infer<typeof ReadBriefInput>
type Out = z.infer<typeof ReadBriefOutput>
type Settings = z.infer<typeof ReadBriefSettings>

const QUESTIONS = [
    "NIVO features, plans and the public price table",
    "brand voice, words to use and avoid",
    "script structure and content pillars",
]

/**
 * `nivo-gtm.studio-read-brief` (Đọc đề bài kịch bản): a decision node. It reads the chosen idea, what the brain says (public product facts and prices, the internal voice and pillars) and the hooks of the best past
 * scripts (approved or published items), so the draft is written from facts and not from memory.
 */
export class StudioReadBrief implements Node<typeof ReadBriefInput, typeof ReadBriefOutput, typeof ReadBriefSettings> {
    readonly key = keyOf("studio-read-brief")
    readonly version = 1
    readonly title = { vi: "Đọc đề bài kịch bản", en: "Read the script brief" }
    readonly input = ReadBriefInput
    readonly output = ReadBriefOutput
    readonly settings = ReadBriefSettings
    readonly reads = ["object.get", "object.query", "brain.search"]

    run(input: In, reach: NodeReach<Settings>): Out {
        const got = reach.objects(Content).get(refOf<Content>(input.objectId))
        if (got.error) throw got.error
        const brain: Array<z.infer<typeof Passage>> = []
        for (const query of QUESTIONS) {
            const { result } = reach.call<BrainSearch>("brain.search", { query, limit: reach.settings.brainHits })
            for (const hit of result.hits)
                brain.push({ query: clip(query, 120), text: clip(JSON.stringify(hit.passage ?? hit.truth), 1200) })
        }
        const past: Array<z.infer<typeof Past>> = []
        if (reach.settings.pastScripts > 0) {
            const found = reach.objects(Content).query({
                where: { status: { in: ["approved", "published"] } },
                sort: { by: "updatedAt", direction: "desc" },
                limit: reach.settings.pastScripts,
            })
            if (found.error) throw found.error
            for (const item of found.result.items)
                past.push({
                    title: item.values.title,
                    hook: clip(textOf(item.values.script?.["hook"] ?? item.values.hook), 400),
                })
        }
        const values = got.result.values
        return {
            objectId: got.result.id,
            code: values.code,
            title: values.title,
            pillar: values.pillar ?? "",
            hook: values.hook ?? "",
            brain,
            past,
        }
    }
}
