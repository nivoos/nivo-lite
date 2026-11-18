import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { Demo } from "../../../objects/demo.object.ts"
import { Lead, type LEAD_STAGES } from "../../../objects/lead.object.ts"
import { keyOf } from "../../../package-key.ts"
import { vnMidnight } from "../common/vn-time.ts"

export const CountLeadsInput = z.strictObject({ instant: z.string().max(40).min(10) })
export const CountLeadsOutput = z.strictObject({
    text: z.string().min(1).max(1800),
    leads: z.number().int().nonnegative(),
    overdue: z.number().int().nonnegative(),
})
/** How many sources the report lists. A workspace may change it in the console. */
export const CountLeadsSettings = z.strictObject({ topSources: z.number().int().min(1).max(20).default(5) })

type In = z.infer<typeof CountLeadsInput>
type Out = z.infer<typeof CountLeadsOutput>
type Settings = z.infer<typeof CountLeadsSettings>

const DAY_MS = 86_400_000
/** The stages a lead is still being worked in; a next action past its due time counts as overdue only here. */
const ACTIVE: ReadonlyArray<(typeof LEAD_STAGES)[number]> = ["new", "engaged", "qualified", "demo_booked"]

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
    readonly reads = ["object.count", "object.aggregate"]

    run(input: In, reach: NodeReach<Settings>): Out {
        const now = Date.parse(input.instant)
        const byStage = reach.objects(Lead).aggregate({ groupBy: "stage", aggregates: [{ op: "count", as: "total" }] })
        if (byStage.error) throw byStage.error
        const bySourceRows = reach
            .objects(Lead)
            .aggregate({ groupBy: "source", aggregates: [{ op: "count", as: "total" }] })
        if (bySourceRows.error) throw bySourceRows.error
        const overdueAnswer = reach
            .objects(Lead)
            .count({ where: { stage: { in: ACTIVE }, nextAt: { lt: new Date(now).toISOString() } } })
        if (overdueAnswer.error) throw overdueAnswer.error
        const dayStart = vnMidnight(now)
        const todayAnswer = reach.objects(Demo).count({
            where: {
                status: "confirmed",
                at: { gte: new Date(dayStart).toISOString(), lt: new Date(dayStart + DAY_MS).toISOString() },
            },
        })
        if (todayAnswer.error) throw todayAnswer.error
        const upcomingAnswer = reach.objects(Demo).count({ where: { status: "confirmed" } })
        if (upcomingAnswer.error) throw upcomingAnswer.error
        const stages = new Map(byStage.result.rows.map((row) => [row.group, Number(row.values["total"] ?? 0)]))
        const count = (stage: string): number => stages.get(stage) ?? 0
        const total = [...stages.values()].reduce((sum, value) => sum + value, 0)
        const sources = bySourceRows.result.rows
            .map((row) => ({ name: row.group ?? "khác", total: Number(row.values["total"] ?? 0) }))
            .sort((left, right) => right.total - left.total)
            .slice(0, reach.settings.topSources)
            .map((source) => `${source.name} ${source.total}`)
            .join(", ")
        const overdue = overdueAnswer.result.count
        const today = todayAnswer.result.count
        const lines = [
            `Tổng số khách đang có: ${total}`,
            `Mới ${count("new")} · đang trò chuyện ${count("engaged")} · đạt chuẩn ${count("qualified")} · đã hẹn demo ${count("demo_booked")} · đã demo ${count("demo_done")}`,
            `Thắng ${count("won")} · nguội ${count("cold")} · không phù hợp ${count("unfit")} · mất ${count("lost")}`,
            `Nguồn: ${sources === "" ? "chưa có" : sources}`,
            `Demo hôm nay: ${today} · demo sắp tới: ${upcomingAnswer.result.count}`,
            `Việc tiếp theo quá hạn: ${overdue}`,
        ]
        return { text: lines.join("\n"), leads: total, overdue }
    }
}
