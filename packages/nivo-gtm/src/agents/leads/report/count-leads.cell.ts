import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { Demo } from "../../../objects/demo.object.ts"
import { Lead } from "../../../objects/lead.object.ts"
import { keyOf } from "../../../package-key.ts"
import { vnMidnight } from "../common/vn-time.ts"

export const CountLeadsInput = z.strictObject({ instant: z.string().min(10) })
export const CountLeadsOutput = z.strictObject({ text: z.string().min(1).max(1800), leads: z.number().int().nonnegative(), overdue: z.number().int().nonnegative() })
/** How many sources the report lists. A workspace may change it in the console. */
export const CountLeadsSettings = z.strictObject({ topSources: z.number().int().min(1).max(20).default(5) })

type In = z.infer<typeof CountLeadsInput>
type Out = z.infer<typeof CountLeadsOutput>
type Settings = z.infer<typeof CountLeadsSettings>

const DAY_MS = 86_400_000
const ACTIVE = ["new", "engaged", "qualified", "demo_booked"]

/**
 * `nivo-gtm.leads-count-leads` (Số liệu chăm khách): counts the day from the `gtm.lead` and `gtm.demo` objects and writes the report text: leads by stage and by source, the demos of the day and the next
 * actions that are overdue. A decision node: it reads only (the post is the next step).
 */
export class CountLeads implements Node<typeof CountLeadsInput, typeof CountLeadsOutput, typeof CountLeadsSettings> {
    readonly key = keyOf("leads-count-leads")
    readonly version = 1
    readonly title = { vi: "Đếm số liệu chăm khách", en: "Count the day's leads" }
    readonly input = CountLeadsInput
    readonly output = CountLeadsOutput
    readonly settings = CountLeadsSettings
    readonly reads = ["object.query"]

    run(input: In, reach: NodeReach<Settings>): Out {
        const now = Date.parse(input.instant)
        const leads = reach.objects(Lead).query({ limit: 200 })
        if (leads.error) throw leads.error
        const demos = reach.objects(Demo).query({ where: { status: "confirmed" }, limit: 200 })
        if (demos.error) throw demos.error
        const items = leads.result.items.map((lead) => lead.values)
        const count = (stage: string): number => items.filter((lead) => lead.stage === stage).length
        const bySource: Record<string, number> = {}
        for (const lead of items) {
            const source = lead.source ?? "khác"
            bySource[source] = (bySource[source] ?? 0) + 1
        }
        const sources = Object.entries(bySource)
            .sort((a, b) => b[1] - a[1])
            .slice(0, reach.settings.topSources)
            .map(([name, total]) => `${name} ${total}`)
            .join(", ")
        const overdue = items.filter((lead) => ACTIVE.includes(lead.stage) && lead.nextAt !== undefined && Date.parse(lead.nextAt) < now).length
        const dayStart = vnMidnight(now)
        const today = demos.result.items.filter((demo) => demo.values.at !== undefined && Date.parse(demo.values.at) >= dayStart && Date.parse(demo.values.at) < dayStart + DAY_MS).length
        const lines = [
            `Tổng số khách đang có: ${items.length}`,
            `Mới ${count("new")} · đang trò chuyện ${count("engaged")} · đạt chuẩn ${count("qualified")} · đã hẹn demo ${count("demo_booked")} · đã demo ${count("demo_done")}`,
            `Thắng ${count("won")} · nguội ${count("cold")} · không phù hợp ${count("unfit")} · mất ${count("lost")}`,
            `Nguồn: ${sources === "" ? "chưa có" : sources}`,
            `Demo hôm nay: ${today} · demo sắp tới: ${demos.result.items.length}`,
            `Việc tiếp theo quá hạn: ${overdue}`,
        ]
        return { text: lines.join("\n"), leads: items.length, overdue }
    }
}
