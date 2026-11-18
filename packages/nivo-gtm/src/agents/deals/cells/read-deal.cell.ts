import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { Deal } from "../../../objects/deal.object.ts"
import { Lead } from "../../../objects/lead.object.ts"
import { keyOf } from "../../../package-key.ts"
import { refOf } from "../../../common/helpers/refs.ts"

export const ReadDealInput = z.strictObject({ dealId: z.string().max(80).min(1) })
/** Empty text and 0 stand for "not set yet", so every member is always there. */
export const ReadDealOutput = z.strictObject({
    dealId: z.string().max(80),
    version: z.number().int(),
    code: z.string().max(80),
    status: z.string().max(80),
    plan: z.string().max(80),
    months: z.number().int(),
    creditPack: z.string().max(80),
    discountPercent: z.number(),
    amount: z.number(),
    payCode: z.string().max(20),
    leadId: z.string().max(80),
    leadName: z.string().max(200),
    channel: z.string().max(40),
    chatRef: z.string().max(200),
})

type In = z.infer<typeof ReadDealInput>
type Out = z.infer<typeof ReadDealOutput>

/** `nivo-gtm.read-deal` (Đọc đơn bán): reads the deal and its lead into one flat answer (the pay code is the deal's code, which the engine issued). Read-only: no act. */
export class ReadDeal implements Node<typeof ReadDealInput, typeof ReadDealOutput> {
    readonly key = keyOf("read-deal")
    readonly version = 2
    readonly title = { vi: "Đọc đơn bán", en: "Read the deal" }
    readonly input = ReadDealInput
    readonly output = ReadDealOutput
    readonly reads = ["object.get"]

    run(input: In, reach: NodeReach): Out {
        const deal = reach.objects(Deal).get(refOf<Deal>(input.dealId))
        if (deal.error) throw deal.error
        const values = deal.result.values
        const lead = reach.objects(Lead).get(values.lead)
        if (lead.error) throw lead.error
        return {
            dealId: input.dealId,
            version: deal.result.version,
            code: values.code,
            status: values.status,
            plan: values.plan ?? "",
            months: values.months ?? 0,
            creditPack: values.creditPack ?? "",
            discountPercent: values.discountPercent ?? 0,
            amount: values.amount ?? 0,
            payCode: values.code,
            leadId: String(values.lead),
            leadName: lead.result.values.name ?? "",
            channel: lead.result.values.channel ?? "",
            chatRef: lead.result.values.chatRef ?? "",
        }
    }
}
