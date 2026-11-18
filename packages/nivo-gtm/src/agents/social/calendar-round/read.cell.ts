import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { Content } from "../../../objects/content.object.ts"
import { Publication } from "../../../objects/publication.object.ts"
import { keyOf } from "../../../package-key.ts"

export const ReadInput = z.strictObject({ instant: z.string().max(40).min(10) })
const Item = z.strictObject({
    id: z.string().max(80),
    code: z.string().max(40),
    title: z.string().max(200),
    kind: z.string().max(20),
    caption: z.string().max(400),
})
const Metric = z.strictObject({
    channel: z.string().max(20),
    views: z.number().int(),
    engagements: z.number().int(),
    leads: z.number().int(),
})
export const ReadOutput = z.strictObject({
    instant: z.string().max(40),
    items: z.array(Item).max(20),
    metrics: z.array(Metric).max(10),
})
/** How many approved items a week's plan considers. */
export const ReadSettings = z.strictObject({ maxItems: z.number().int().min(1).max(20).default(14) })

type In = z.infer<typeof ReadInput>
type Out = z.infer<typeof ReadOutput>
type Settings = z.infer<typeof ReadSettings>

/**
 * `nivo-gtm.social-calendar-read` (Đọc nội dung chờ lên lịch): a decision node. It reads the approved `gtm.content` items that have no publication yet, and last week's metrics, so the plan places only what is ready.
 */
export class SocialCalendarRead implements Node<typeof ReadInput, typeof ReadOutput, typeof ReadSettings> {
    readonly key = keyOf("social-calendar-read")
    readonly version = 1
    readonly title = { vi: "Đọc nội dung chờ lên lịch", en: "Read what is ready to schedule" }
    readonly input = ReadInput
    readonly output = ReadOutput
    readonly settings = ReadSettings
    readonly reads = ["object.query"]

    run(input: In, reach: NodeReach<Settings>): Out {
        const approved = reach
            .objects(Content)
            .query({ where: { status: "approved" }, sort: { by: "updatedAt", direction: "asc" }, limit: 50 })
        if (approved.error) throw approved.error
        const planned = reach
            .objects(Publication)
            .query({ where: { status: { in: ["planned", "scheduled", "published"] } }, limit: 200 })
        if (planned.error) throw planned.error
        const taken = new Set(planned.result.items.map((item) => String(item.values.content)))
        const items = approved.result.items
            .filter((item) => !taken.has(String(item.id)))
            .slice(0, reach.settings.maxItems)
            .map((item) => ({
                id: String(item.id),
                code: item.values.code,
                title: item.values.title,
                kind: item.values.kind,
                caption: (item.values.caption ?? "").slice(0, 400),
            }))
        const published = reach
            .objects(Publication)
            .query({ where: { status: "published" }, sort: { by: "at", direction: "desc" }, limit: 10 })
        if (published.error) throw published.error
        const metrics = published.result.items.map((item) => ({
            channel: item.values.channel,
            views: item.values.views ?? 0,
            engagements: item.values.engagements ?? 0,
            leads: item.values.leads ?? 0,
        }))
        return { instant: input.instant, items, metrics }
    }
}
