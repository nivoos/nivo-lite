import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import type { PayRequested } from "../../../common/events/pay-requested.event.ts"
import { keyOf } from "../../../package-key.ts"

export const EmitPayRequestedInput = z.strictObject({
    dealId: z.string().min(1),
    payCode: z.string().regex(/^[A-Z]{2,5}[0-9]{4,12}$/u),
    amount: z.number().int().min(0),
    /** 1 for the first watch, 2 for the one after the reminder: part of the event key. */
    round: z.number().int().min(1).max(5),
})
export const EmitPayRequestedOutput = z.strictObject({ requested: z.literal(true), round: z.number().int() })

type In = z.infer<typeof EmitPayRequestedInput>
type Out = z.infer<typeof EmitPayRequestedOutput>

/**
 * `nivo-gtm.emit-pay-requested` (Mở theo dõi thanh toán): ONE act, `events.emit` of `PayRequested` on the subject `order:<payCode>` with `link: true`, so the watch run it opens is a CHILD of this run (the subject
 * is the one SePay's `sepay.payment.paid` names, so the watch takes the transfer) and its end comes back as `Ended`.
 */
export class EmitPayRequested implements Node<typeof EmitPayRequestedInput, typeof EmitPayRequestedOutput> {
    readonly key = keyOf("emit-pay-requested")
    readonly version = 2
    readonly title = { vi: "Mở theo dõi thanh toán", en: "Start watching the payment" }
    readonly input = EmitPayRequestedInput
    readonly output = EmitPayRequestedOutput
    readonly reads = []
    readonly mutation = "events.emit"

    run(input: In, reach: NodeReach): Out {
        const { error } = reach.emit<typeof PayRequested>("nivo-gtm.pay.requested", {
            subject: { kind: "order", id: input.payCode },
            data: { dealId: input.dealId, payCode: input.payCode, amount: input.amount },
            key: `pay:${input.payCode}:${String(input.round)}`,
            link: true,
        })
        if (error) throw error
        return { requested: true, round: input.round }
    }
}
