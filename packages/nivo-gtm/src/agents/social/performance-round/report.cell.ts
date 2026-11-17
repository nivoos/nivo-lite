import { z } from "zod"
import type { ModelGenerate, Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { clip } from "../common/helpers.ts"
import { SOCIAL_POLICY } from "../common/social.policy.ts"
import { PullOutput } from "./pull.cell.ts"

export const ReportInput = z.strictObject({ instant: z.string(), items: PullOutput.shape.items, totals: PullOutput.shape.totals })
const Written = z.strictObject({ summary: z.string().min(1).max(1500), suggestion: z.string().min(1).max(500) })
export const ReportOutput = z.strictObject({ cardText: z.string().min(1).max(3000) })

type In = z.infer<typeof ReportInput>
type Out = z.infer<typeof ReportOutput>
type Written = z.infer<typeof Written>

const GOAL =
    "Write the weekly social report for the team in Vietnamese. `totals` are the exact figures of the last days; `items` are the publications. In `summary`: what was published, which channel and item did best, and how it compares when the data allows. " +
    "In `suggestion`: ONE suggestion for next week. Quote only the figures given; never invent a number or a trend the data cannot show. If there is no data, say so plainly."

/** `nivo-gtm.social-report` (Báo cáo tuần mạng xã hội): ONE generation, the Monday report: the week from the exact figures, with ONE suggestion. The card text is made here from the figures and the model's words. */
export class SocialReport implements Node<typeof ReportInput, typeof ReportOutput> {
    readonly key = keyOf("social-report")
    readonly version = 1
    readonly title = { vi: "Báo cáo tuần mạng xã hội", en: "Weekly social report" }
    readonly input = ReportInput
    readonly output = ReportOutput
    readonly reads = []
    readonly mutation = "model.generate"
    readonly model = { model: "sonnet-5-5", effort: "balanced" } as const

    run(input: In, reach: NodeReach): Out {
        const { result, error } = reach.call<ModelGenerate<Written>>("model.generate", { prompt: `${SOCIAL_POLICY}\n\n${GOAL}`, data: { instant: input.instant, totals: input.totals, items: input.items } })
        if (error) throw error
        const t = input.totals
        const figures = `Bài đã đăng: ${String(t.publications)} · Lượt xem: ${String(t.views)} · Tiếp cận: ${String(t.reach)} · Tương tác: ${String(t.engagements)} · Lượt bấm: ${String(t.clicks)} · Khách từ bài: ${String(t.leads)}`
        return { cardText: clip(`Báo cáo mạng xã hội tuần (${input.instant.slice(0, 10)})\n${figures}\n\n${result.value.summary}\n\nĐề xuất tuần tới: ${result.value.suggestion}`, 3000) }
    }
}
