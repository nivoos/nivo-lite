import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { Deal } from "../../../objects/deal.object.ts"
import { plusHours } from "../../../common/helpers/text.ts"
import { keyOf } from "../../../package-key.ts"

export const OpenDealInput = z.strictObject({ leadId: z.string().min(1), demoId: z.string().min(1), suggestedPlan: z.string().max(60) })
export const OpenDealOutput = z.strictObject({ dealId: z.string(), code: z.string(), owner: z.string() })
/** Who sells: the people a new deal goes to in turn (member ids or names); placeholders until the owner names them. */
export const OpenDealSettings = z.strictObject({
    salesPeople: z.array(z.string().min(1).max(80)).max(20).default(["Minh Trần"]),
    quoteWithinHours: z.number().int().min(1).max(720).default(24),
})

type In = z.infer<typeof OpenDealInput>
type Out = z.infer<typeof OpenDealOutput>
type Settings = z.infer<typeof OpenDealSettings>

/**
 * `nivo-gtm.open-deal` (Mở đơn bán): one act, `object.create` (an upsert on `demoRef`) of the `gtm.deal` (status `proposal`) after a demo. The engine issues the deal code (the pay code), and the same demo finds the same deal,
 * so a repeat is never a second one. The owner is the next sales person in turn from the setting `salesPeople` (the turn is the number of deals so far); the next action is to quote within `quoteWithinHours`.
 */
export class OpenDeal implements Node<typeof OpenDealInput, typeof OpenDealOutput, typeof OpenDealSettings> {
    readonly key = keyOf("open-deal")
    readonly version = 2
    readonly title = { vi: "Mở đơn bán", en: "Open the deal" }
    readonly input = OpenDealInput
    readonly output = OpenDealOutput
    readonly settings = OpenDealSettings
    readonly reads = ["object.count"]
    readonly mutation = "object.create"

    run(input: In, reach: NodeReach<Settings>): Out {
        const people = reach.settings.salesPeople
        const deals = reach.objects(Deal).count()
        if (deals.error) throw deals.error
        const owner = people[deals.result.count % people.length] ?? ""
        const { result, error } = reach.objects(Deal).create({
            demoRef: input.demoId,
            lead: input.leadId as never,
            status: "proposal",
            ...(input.suggestedPlan === "" ? {} : { plan: input.suggestedPlan }),
            owner,
            nextAction: "Báo giá cho khách",
            nextAt: plusHours(reach.facts.at, reach.settings.quoteWithinHours),
            evidence: `demo:${input.demoId}`,
        }, { upsert: true })
        if (error) throw error
        return { dealId: result.id, code: result.values.code, owner: result.values.owner ?? owner }
    }
}
