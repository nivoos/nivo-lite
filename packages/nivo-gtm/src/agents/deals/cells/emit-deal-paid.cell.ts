import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import type { DealPaid } from "../../../common/events/deal-paid.event.ts"
import { keyOf } from "../../../package-key.ts"

export const EmitDealPaidInput = z.strictObject({ dealId: z.string().min(1), code: z.string().min(1).max(40), amount: z.number().int().min(0) })
export const EmitDealPaidOutput = z.strictObject({ emitted: z.literal(true) })

type In = z.infer<typeof EmitDealPaidInput>
type Out = z.infer<typeof EmitDealPaidOutput>

/** `nivo-gtm.emit-deal-paid` (Báo đơn đã thu tiền): ONE act, `events.emit` of `DealPaid` on the subject `deal:<id>`, keyed by the deal so a repeat is one event. The activate workflow starts on it. */
export class EmitDealPaid implements Node<typeof EmitDealPaidInput, typeof EmitDealPaidOutput> {
    readonly key = keyOf("emit-deal-paid")
    readonly version = 1
    readonly title = { vi: "Báo đơn đã thu tiền", en: "Announce the deal as paid" }
    readonly input = EmitDealPaidInput
    readonly output = EmitDealPaidOutput
    readonly reads = []
    readonly mutation = "events.emit"

    run(input: In, reach: NodeReach): Out {
        const { error } = reach.emit<typeof DealPaid>("nivo-gtm.deal.paid", {
            subject: { kind: "deal", id: input.dealId },
            data: { dealId: input.dealId, dealCode: input.code, amount: input.amount },
            key: `deal-paid:${input.code}`,
        })
        if (error) throw error
        return { emitted: true }
    }
}
