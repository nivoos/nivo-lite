import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { Deal } from "../../../objects/deal.object.ts"
import { Lead } from "../../../objects/lead.object.ts"
import { keyOf } from "../../../package-key.ts"

export const LostWeekInput = z.strictObject({ day: z.string().max(40) })
export const LostWeekOutput = z.strictObject({
    lostDeals: z.number().int(),
    coldLeads: z.number().int(),
    lostLeads: z.number().int(),
    /** One line per item: the code and the reason or next action on it. */
    lines: z.array(z.string().max(300)).max(60),
})
export const LostWeekSettings = z.strictObject({ limit: z.number().int().min(1).max(50).default(30) })

type In = z.infer<typeof LostWeekInput>
type Out = z.infer<typeof LostWeekOutput>
type Settings = z.infer<typeof LostWeekSettings>

/**
 * `nivo-gtm.lost-week` (Đọc đơn mất và khách nguội): reads the deals in `lost` and the leads in `cold` or `lost`, newest first, up to `limit` of each. Read-only: no act. (The objects carry no
 * change date, so "this week" is the newest `limit`; the weekly run is the window.)
 */
export class LostWeek implements Node<typeof LostWeekInput, typeof LostWeekOutput, typeof LostWeekSettings> {
    readonly key = keyOf("lost-week")
    readonly version = 1
    readonly title = { vi: "Đọc đơn mất và khách nguội", en: "Read the lost deals and cold leads" }
    readonly input = LostWeekInput
    readonly output = LostWeekOutput
    readonly settings = LostWeekSettings
    readonly reads = ["object.query"]

    run(_input: In, reach: NodeReach<Settings>): Out {
        const limit = reach.settings.limit
        const deals = reach.objects(Deal).query({ where: { status: "lost" }, sort: { by: "updatedAt", direction: "desc" }, limit })
        if (deals.error) throw deals.error
        const cold = reach.objects(Lead).query({ where: { stage: "cold" }, sort: { by: "updatedAt", direction: "desc" }, limit })
        if (cold.error) throw cold.error
        const lost = reach.objects(Lead).query({ where: { stage: "lost" }, sort: { by: "updatedAt", direction: "desc" }, limit })
        if (lost.error) throw lost.error
        const lines: string[] = []
        for (const item of deals.result.items) lines.push(`Đơn mất ${item.values.code}: ${item.values.nextAction ?? item.values.evidence ?? "không ghi lý do"}`)
        for (const item of lost.result.items) lines.push(`Khách mất ${item.values.code}: ${item.values.lostReason ?? "không ghi lý do"}`)
        for (const item of cold.result.items) lines.push(`Khách nguội ${item.values.code}: ${item.values.nextAction ?? "chưa có việc tiếp theo"}`)
        return { lostDeals: deals.result.items.length, coldLeads: cold.result.items.length, lostLeads: lost.result.items.length, lines: lines.slice(0, 60) }
    }
}
