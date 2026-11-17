import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { money } from "../../../common/helpers/text.ts"
import { keyOf } from "../../../package-key.ts"

export const PriceInput = z.strictObject({
    months: z.number().int().min(0).max(36),
    creditPack: z.string().max(60),
    /** The discount the sales person asked for, in percent; 0 means "the standard one for the months". */
    requestedDiscount: z.number().min(0).max(100),
})
export const PriceOutput = z.strictObject({
    ok: z.boolean(),
    /** Why not ok: `discount_over_limit` or `unknown_credit_pack`; empty when ok. */
    reason: z.string().max(60),
    months: z.number().int(),
    planName: z.string().max(60),
    base: z.number().int(),
    discountPercent: z.number(),
    subtotal: z.number().int(),
    packAmount: z.number().int(),
    amount: z.number().int(),
    /** The discount is above `ownerApprovesAbove`: the owner decides before the quote is sent. */
    needsOwner: z.boolean(),
    trialDays: z.number().int(),
    /** The quote lines in words, figures only from this cell. */
    lines: z.string().max(600),
})
/**
 * The price list, as per-customer settings with defaults. PLACEHOLDERS the owner replaces: the "Vận hành" plan at 1.490.000đ a month, credit packs of 200k, 500k and 1tr, a prepay discount of 10% for 6 months
 * and 15% for 12 months (approved by the owner), at most 20% in all, the owner decides above 15%.
 */
export const PriceSettings = z.strictObject({
    planName: z.string().min(1).max(60).default("Vận hành"),
    monthlyPrice: z.number().int().min(0).default(1490000),
    creditPacks: z.record(z.string(), z.number().int().min(0)).default({ "200k": 200000, "500k": 500000, "1tr": 1000000 }),
    prepayDiscounts: z.record(z.string(), z.number().min(0).max(100)).default({ "6": 10, "12": 15 }),
    maxDiscountPercent: z.number().min(0).max(100).default(20),
    ownerApprovesAbove: z.number().min(0).max(100).default(15),
    trialDays: z.number().int().min(0).max(60).default(7),
})

type In = z.infer<typeof PriceInput>
type Out = z.infer<typeof PriceOutput>
type Settings = z.infer<typeof PriceSettings>

const refused = (reason: string, months: number, planName: string): Out => ({ ok: false, reason, months, planName, base: 0, discountPercent: 0, subtotal: 0, packAmount: 0, amount: 0, needsOwner: false, trialDays: 0, lines: "" })

/**
 * `nivo-gtm.price` (Tính giá báo): the amount of a quote from the price-list SETTINGS (never from a model): the plan's monthly price times the months, less the prepay discount for those months (or the
 * discount the sales person asked for), plus the credit pack. A discount above `maxDiscountPercent` is refused (`discount_over_limit`); above `ownerApprovesAbove` it needs the owner. Pure logic: no act.
 */
export class Price implements Node<typeof PriceInput, typeof PriceOutput, typeof PriceSettings> {
    readonly key = keyOf("price")
    readonly version = 1
    readonly title = { vi: "Tính giá báo", en: "Price the quote" }
    readonly input = PriceInput
    readonly output = PriceOutput
    readonly settings = PriceSettings
    readonly reads = []

    run(input: In, reach: NodeReach<Settings>): Out {
        const s = reach.settings
        const months = input.months < 1 ? 1 : input.months
        const base = s.monthlyPrice * months
        const standard = s.prepayDiscounts[String(months)] ?? 0
        const discountPercent = input.requestedDiscount > 0 ? input.requestedDiscount : standard
        if (discountPercent > s.maxDiscountPercent) return refused("discount_over_limit", months, s.planName)
        const packAmount = input.creditPack === "" ? 0 : (s.creditPacks[input.creditPack] ?? -1)
        if (packAmount < 0) return refused("unknown_credit_pack", months, s.planName)
        const subtotal = Math.round((base * (100 - discountPercent)) / 100)
        const amount = subtotal + packAmount
        const lines =
            `Gói ${s.planName}: ${money(s.monthlyPrice)} x ${String(months)} tháng = ${money(base)}\n` +
            `${discountPercent > 0 ? `Giảm ${String(discountPercent)}%: còn ${money(subtotal)}\n` : ""}` +
            `${packAmount > 0 ? `Gói nạp credit ${input.creditPack}: ${money(packAmount)}\n` : ""}` +
            `Tổng: ${money(amount)}`
        return { ok: true, reason: "", months, planName: s.planName, base, discountPercent, subtotal, packAmount, amount, needsOwner: discountPercent > s.ownerApprovesAbove, trialDays: s.trialDays, lines }
    }
}
