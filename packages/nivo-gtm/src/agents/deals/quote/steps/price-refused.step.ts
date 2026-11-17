import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../quote.workflow.ts"

/** The price cell refused the plan (a discount over the limit or an unknown credit pack); the reason is in the price; the sales person fixes the plan and fills it again. */
export class PriceRefused extends NodeEnd<typeof State> {
    override readonly reason = "price_refused"
}
