import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { Deal, DEAL_STATUSES } from "../../../objects/deal.object.ts"
import { plusHours } from "../../../common/helpers/text.ts"
import { keyOf } from "../../../package-key.ts"

export const UpdateDealInput = z.strictObject({
    dealId: z.string().min(1),
    status: z.enum(DEAL_STATUSES).optional(),
    amount: z.number().int().min(0).optional(),
    discountPercent: z.number().min(0).max(100).optional(),
    payCode: z.string().max(40).optional(),
    sepayRef: z.string().max(80).optional(),
    nextAction: z.string().max(300).optional(),
    /** `nextAt` is the due time the setting of this business timing gives, counted from now; absent leaves it as it is. */
    due: z.enum(["quote_follow_up", "payment", "activation", "care"]).optional(),
    evidence: z.string().max(2000).optional(),
    /** Stamps `paidAt` or `activatedAt` with the time of the run. */
    stamp: z.enum(["none", "paid", "activated"]),
})
/** The business timings of a deal, in hours: how long a quote waits for a yes, a payment for the transfer (also the wait of the payment watch), an activation for the activator, and the new customer for the first care. */
export const UpdateDealSettings = z.strictObject({
    quoteFollowUpHours: z.number().int().min(1).max(8760).default(48),
    unpaidHours: z.number().int().min(1).max(8760).default(72),
    activationHours: z.number().int().min(1).max(8760).default(24),
    careHours: z.number().int().min(1).max(8760).default(168),
})
export const UpdateDealOutput = z.strictObject({ version: z.number().int() })

type In = z.infer<typeof UpdateDealInput>
type Out = z.infer<typeof UpdateDealOutput>
type Settings = z.infer<typeof UpdateDealSettings>

const DUE_HOURS = (settings: Settings, due: NonNullable<In["due"]>): number =>
    due === "quote_follow_up" ? settings.quoteFollowUpHours : due === "payment" ? settings.unpaidHours : due === "activation" ? settings.activationHours : settings.careHours

/**
 * `nivo-gtm.update-deal` (Cập nhật đơn bán): ONE act, `object.update` of the `gtm.deal`: a status, the money fields, the responsibility fields (next action, due time, evidence) and, on request, the time
 * of payment or activation. It reads the deal first for the version it updates against. Every status change of a deal in this package goes through this cell.
 */
export class UpdateDeal implements Node<typeof UpdateDealInput, typeof UpdateDealOutput, typeof UpdateDealSettings> {
    readonly key = keyOf("update-deal")
    readonly version = 2
    readonly title = { vi: "Cập nhật đơn bán", en: "Update the deal" }
    readonly input = UpdateDealInput
    readonly output = UpdateDealOutput
    readonly settings = UpdateDealSettings
    readonly reads = ["object.get"]
    readonly mutation = "object.update"

    run(input: In, reach: NodeReach<Settings>): Out {
        const deal = reach.objects(Deal).get(input.dealId as never)
        if (deal.error) throw deal.error
        const { result, error } = reach.objects(Deal).update({
            id: input.dealId as never,
            version: deal.result.version,
            values: {
                ...(input.status === undefined ? {} : { status: input.status }),
                ...(input.amount === undefined ? {} : { amount: input.amount }),
                ...(input.discountPercent === undefined ? {} : { discountPercent: input.discountPercent }),
                ...(input.payCode === undefined ? {} : { payCode: input.payCode }),
                ...(input.sepayRef === undefined ? {} : { sepayRef: input.sepayRef }),
                ...(input.nextAction === undefined ? {} : { nextAction: input.nextAction }),
                ...(input.due === undefined ? {} : { nextAt: plusHours(reach.facts.at, DUE_HOURS(reach.settings, input.due)) }),
                ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
                ...(input.stamp === "paid" ? { paidAt: reach.facts.at } : {}),
                ...(input.stamp === "activated" ? { activatedAt: reach.facts.at } : {}),
            },
        })
        if (error) throw error
        return { version: result.version }
    }
}
