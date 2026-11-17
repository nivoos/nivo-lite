import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { Deal } from "../../../objects/deal.object.ts"
import { digitsOf, plusHours } from "../../../common/helpers/text.ts"
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
 * `nivo-gtm.open-deal` (Mở đơn bán): one act, `object.create` of the `gtm.deal` (status `proposal`) after a demo. The deal code is eight digits made from the lead and the demo (the same demo makes the
 * same code, so a repeat is refused by the unique code, not doubled); the owner is the next sales person in turn from the setting `salesPeople`; the next action is to quote within `quoteWithinHours`.
 */
export class OpenDeal implements Node<typeof OpenDealInput, typeof OpenDealOutput, typeof OpenDealSettings> {
    readonly key = keyOf("open-deal")
    readonly version = 1
    readonly title = { vi: "Mở đơn bán", en: "Open the deal" }
    readonly input = OpenDealInput
    readonly output = OpenDealOutput
    readonly settings = OpenDealSettings
    readonly reads = []
    readonly mutation = "object.create"

    run(input: In, reach: NodeReach<Settings>): Out {
        const code = digitsOf(`${input.leadId}:${input.demoId}`)
        const people = reach.settings.salesPeople
        const owner = people[Number(code) % people.length] ?? ""
        const { result, error } = reach.objects(Deal).create({
            code,
            lead: input.leadId as never,
            status: "proposal",
            ...(input.suggestedPlan === "" ? {} : { plan: input.suggestedPlan }),
            owner,
            nextAction: "Báo giá cho khách",
            nextAt: plusHours(reach.facts.at, reach.settings.quoteWithinHours),
            evidence: `demo:${input.demoId}`,
        })
        if (error) throw error
        return { dealId: result.id, code, owner }
    }
}
