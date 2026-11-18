import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { Price as PriceCell } from "../../cells/price.cell.ts"
import type { State } from "../quote.workflow.ts"
import { PriceOk } from "./price-ok.step.ts"

/** Pure logic over the price-list settings. */
export class Price extends NodeRun(PriceCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        months: s.deal.months,
        creditPack: s.deal.creditPack,
        requestedDiscount: s.deal.discountPercent,
    })
    override readonly into = ["price"] as const
    override readonly next = PriceOk
}
