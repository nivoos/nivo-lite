import { z } from "zod"
import type { Node, NodeReach, NivoValues } from "@starci/nivoos-sdk"
import { Content } from "../../../objects/content.object.ts"
import { Publication } from "../../../objects/publication.object.ts"
import { keyOf } from "../../../package-key.ts"
import type { BrainSearch } from "../common/callees.ts"
import { clip } from "../common/helpers.ts"

export const ReadContextInput = z.strictObject({ instant: z.string().min(10).max(40) })
const Passage = z.strictObject({ query: z.string().max(120), text: z.string().max(1200) })
const Metric = z.strictObject({
    channel: z.string().max(20),
    at: z.string().max(40),
    views: z.number().int(),
    reach: z.number().int(),
    engagements: z.number().int(),
    clicks: z.number().int(),
    leads: z.number().int(),
})
const Past = z.strictObject({ code: z.string().max(40), title: z.string().max(200), pillar: z.string().max(120) })
export const ReadContextOutput = z.strictObject({
    instant: z.string().max(40),
    brain: z.array(Passage).max(24),
    metrics: z.array(Metric).max(30),
    recent: z.array(Past).max(12),
    open: z.array(Past).max(24),
})
/** How much the weekly round reads: brain hits per question, the weeks of metrics and the open ideas it must not repeat. */
export const ReadContextSettings = z.strictObject({
    brainHits: z.number().int().min(1).max(8).default(4),
    metricWeeks: z.number().int().min(1).max(52).default(8),
    openIdeas: z.number().int().min(1).max(24).default(12),
})

type In = z.infer<typeof ReadContextInput>
type Out = z.infer<typeof ReadContextOutput>
type Settings = z.infer<typeof ReadContextSettings>

/** What the round asks the brain: the product facts a video may state (public), then the pillars and the voice (internal). */
const QUESTIONS = [
    "what NIVO is, its features, plans and prices",
    "content pillars and cadence",
    "brand voice, words to use and avoid",
]

/** The title line of one past or open idea the round must not repeat. */
const pastOf = (values: NivoValues<Content>): z.infer<typeof Past> => ({
    code: values.code,
    title: values.title,
    pillar: values.pillar ?? "",
})

/**
 * `nivo-gtm.studio-read-context` (Đọc bối cảnh tuần): the first node of the weekly idea round. A decision node: it only reads, the brain by three questions (public product facts, internal pillars, voice), the
 * metrics of the published items of the last `metricWeeks` weeks and the ideas still open, so the next node does not repeat them.
 */
export class StudioReadContext implements Node<
    typeof ReadContextInput,
    typeof ReadContextOutput,
    typeof ReadContextSettings
> {
    readonly key = keyOf("studio-read-context")
    readonly version = 1
    readonly title = { vi: "Đọc bối cảnh tuần", en: "Read the week's context" }
    readonly input = ReadContextInput
    readonly output = ReadContextOutput
    readonly settings = ReadContextSettings
    readonly reads = ["brain.search", "object.query"]

    run(input: In, reach: NodeReach<Settings>): Out {
        const brain: Array<z.infer<typeof Passage>> = []
        for (const query of QUESTIONS) {
            const { result } = reach.call<BrainSearch>("brain.search", { query, limit: reach.settings.brainHits })
            for (const hit of result.hits)
                brain.push({ query: clip(query, 120), text: clip(JSON.stringify(hit.passage ?? hit.truth), 1200) })
        }
        const since = new Date(Date.parse(input.instant) - reach.settings.metricWeeks * 7 * 86_400_000).toISOString()
        const published = reach
            .objects(Publication)
            .query({ where: { status: "published" }, sort: { by: "at", direction: "desc" }, limit: 30 })
        if (published.error) throw published.error
        const metrics = published.result.items
            .filter((item) => (item.values.at ?? "") >= since)
            .map((item) => ({
                channel: item.values.channel,
                at: item.values.at ?? "",
                views: item.values.views ?? 0,
                reach: item.values.reach ?? 0,
                engagements: item.values.engagements ?? 0,
                clicks: item.values.clicks ?? 0,
                leads: item.values.leads ?? 0,
            }))
        const done = reach
            .objects(Content)
            .query({ where: { status: "published" }, sort: { by: "updatedAt", direction: "desc" }, limit: 12 })
        if (done.error) throw done.error
        const ideas = reach.objects(Content).query({
            where: { status: "idea" },
            sort: { by: "createdAt", direction: "desc" },
            limit: reach.settings.openIdeas,
        })
        if (ideas.error) throw ideas.error
        return {
            instant: input.instant,
            brain,
            metrics,
            recent: done.result.items.map((item) => pastOf(item.values)),
            open: ideas.result.items.map((item) => pastOf(item.values)),
        }
    }
}
