import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { Publication } from "../../../objects/publication.object.ts"
import { keyOf } from "../../../package-key.ts"

export const PullInput = z.strictObject({ instant: z.string().min(10) })
const Item = z.strictObject({ id: z.string(), channel: z.string().max(20), at: z.string().max(40), views: z.number().int(), reach: z.number().int(), engagements: z.number().int(), clicks: z.number().int(), leads: z.number().int() })
const Totals = z.strictObject({ publications: z.number().int(), views: z.number().int(), reach: z.number().int(), engagements: z.number().int(), clicks: z.number().int(), leads: z.number().int() })
export const PullOutput = z.strictObject({
    instant: z.string(),
    source: z.literal("objects"),
    isMonday: z.boolean(),
    items: z.array(Item).max(60),
    totals: Totals,
})
/** How many days back the round looks at what was published. */
export const PullSettings = z.strictObject({ metricDays: z.number().int().min(1).max(90).default(14) })

type In = z.infer<typeof PullInput>
type Out = z.infer<typeof PullOutput>
type Settings = z.infer<typeof PullSettings>

/**
 * `nivo-gtm.social-pull` (Lấy số liệu): a decision node. It reads the publications published in the last `metricDays` days with the numbers each holds. The Telegram bot API gives no view counts, so the source is the objects
 * themselves (`source: "objects"`); the provider seam for Meta, YouTube and TikTok metrics (D1/D2) fills them later. It also says whether the tick is a Monday in Ho Chi Minh City, the day that carries the report.
 */
export class SocialPull implements Node<typeof PullInput, typeof PullOutput, typeof PullSettings> {
    readonly key = keyOf("social-pull")
    readonly version = 1
    readonly title = { vi: "Lấy số liệu bài đã đăng", en: "Pull the numbers" }
    readonly input = PullInput
    readonly output = PullOutput
    readonly settings = PullSettings
    readonly reads = ["object.query"]

    run(input: In, reach: NodeReach<Settings>): Out {
        const found = reach.objects(Publication).query({ where: { status: "published" }, sort: { by: "at", direction: "desc" }, limit: 60 })
        if (found.error) throw found.error
        const since = new Date(Date.parse(input.instant) - reach.settings.metricDays * 86_400_000).toISOString()
        const items = found.result.items
            .filter((item) => (item.values.at ?? "") >= since)
            .map((item) => ({
                id: String(item.id),
                channel: item.values.channel,
                at: item.values.at ?? "",
                views: item.values.views ?? 0,
                reach: item.values.reach ?? 0,
                engagements: item.values.engagements ?? 0,
                clicks: item.values.clicks ?? 0,
                leads: item.values.leads ?? 0,
            }))
        const sum = (pick: (item: (typeof items)[number]) => number): number => items.reduce((total, item) => total + pick(item), 0)
        return {
            instant: input.instant,
            source: "objects",
            isMonday: new Date(Date.parse(input.instant) + 7 * 3_600_000).getUTCDay() === 1,
            items,
            totals: { publications: items.length, views: sum((item) => item.views), reach: sum((item) => item.reach), engagements: sum((item) => item.engagements), clicks: sum((item) => item.clicks), leads: sum((item) => item.leads) },
        }
    }
}
