import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { Deal } from "../../../objects/deal.object.ts"
import { plusHours } from "../../../common/helpers/text.ts"
import { keyOf } from "../../../package-key.ts"
import { refOf } from "../../../common/helpers/refs.ts"

export const SetPlanInput = z.strictObject({ dealId: z.string().max(80).min(1) })
export const SetPlanOutput = z.strictObject({
    version: z.number().int(),
    plan: z.string().max(80),
    months: z.number().int(),
})
/** The plan a "Báo giá" answer fills in; the sales person may change it on the deal before the quote goes out. */
export const SetPlanSettings = z.strictObject({
    defaultPlan: z.string().min(1).max(60).default("Vận hành"),
    defaultMonths: z.number().int().min(1).max(36).default(1),
    quoteReviewHours: z.number().int().min(1).max(720).default(4),
})

type In = z.infer<typeof SetPlanInput>
type Out = z.infer<typeof SetPlanOutput>
type Settings = z.infer<typeof SetPlanSettings>

/**
 * `nivo-gtm.set-plan` (Điền gói cho đơn): the sales person answered "Báo giá" on the brief card, so the deal gets its plan (the default plan and months of the settings). One act, `object.update`: writing
 * the plan is what starts the quote workflow (the `plan` field changed on a deal in `proposal`).
 */
export class SetPlan implements Node<typeof SetPlanInput, typeof SetPlanOutput, typeof SetPlanSettings> {
    readonly key = keyOf("set-plan")
    readonly version = 1
    readonly title = { vi: "Điền gói cho đơn", en: "Fill the plan of the deal" }
    readonly input = SetPlanInput
    readonly output = SetPlanOutput
    readonly settings = SetPlanSettings
    readonly reads = ["object.get"]
    readonly mutation = "object.update"

    run(input: In, reach: NodeReach<Settings>): Out {
        const deal = reach.objects(Deal).get(refOf<Deal>(input.dealId))
        if (deal.error) throw deal.error
        const { result, error } = reach.objects(Deal).update({
            id: refOf<Deal>(input.dealId),
            version: deal.result.version,
            values: {
                plan: reach.settings.defaultPlan,
                months: reach.settings.defaultMonths,
                nextAction: "Soát báo giá rồi duyệt gửi",
                nextAt: plusHours(reach.facts.at, reach.settings.quoteReviewHours),
            },
        })
        if (error) throw error
        return { version: result.version, plan: reach.settings.defaultPlan, months: reach.settings.defaultMonths }
    }
}
