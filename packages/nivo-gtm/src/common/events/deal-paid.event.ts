import { z } from "zod"
import type { EventKind } from "@starci/nivoos-sdk"
import { keyOf } from "../../package-key.ts"

/** What the event carries. */
export const DealPaidData = z.strictObject({
    dealId: z.string().min(1).max(80),
    dealCode: z.string().max(500),
    amount: z.number().int().nonnegative(),
})

/**
 * `nivo-gtm.deal.paid`: a deal's payment arrived (activate takes it). Internal, on the subject `deal:<id>`; the emitter keys it by the object and the transition, so a repeat emit is one event.
 */
export class DealPaid implements EventKind<typeof DealPaidData> {
    readonly key = keyOf("deal.paid")
    readonly version = 1
    readonly title = { vi: "Đơn đã thu tiền", en: "Deal paid" }
    readonly event = DealPaidData
    readonly subjectKind = "deal"
    readonly vias = ["internal"] as const
}
