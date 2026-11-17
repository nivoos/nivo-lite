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
    /** `nextAt` is this many hours from now; absent leaves it as it is. */
    nextInHours: z.number().int().min(0).max(8760).optional(),
    evidence: z.string().max(2000).optional(),
    /** Stamps `paidAt` or `activatedAt` with the time of the run. */
    stamp: z.enum(["none", "paid", "activated"]),
})
export const UpdateDealOutput = z.strictObject({ version: z.number().int() })

type In = z.infer<typeof UpdateDealInput>
type Out = z.infer<typeof UpdateDealOutput>

/**
 * `nivo-gtm.update-deal` (Cập nhật đơn bán): ONE act, `object.update` of the `gtm.deal`: a status, the money fields, the responsibility fields (next action, due time, evidence) and, on request, the time
 * of payment or activation. It reads the deal first for the version it updates against. Every status change of a deal in this package goes through this cell.
 */
export class UpdateDeal implements Node<typeof UpdateDealInput, typeof UpdateDealOutput> {
    readonly key = keyOf("update-deal")
    readonly version = 1
    readonly title = { vi: "Cập nhật đơn bán", en: "Update the deal" }
    readonly input = UpdateDealInput
    readonly output = UpdateDealOutput
    readonly reads = ["object.get"]
    readonly mutation = "object.update"

    run(input: In, reach: NodeReach): Out {
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
                ...(input.nextInHours === undefined ? {} : { nextAt: plusHours(reach.facts.at, input.nextInHours) }),
                ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
                ...(input.stamp === "paid" ? { paidAt: reach.facts.at } : {}),
                ...(input.stamp === "activated" ? { activatedAt: reach.facts.at } : {}),
            },
        })
        if (error) throw error
        return { version: result.version }
    }
}
