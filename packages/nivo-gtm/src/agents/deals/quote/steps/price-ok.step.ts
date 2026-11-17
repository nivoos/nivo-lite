import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../quote.workflow.ts"
import { NeedsOwner } from "./needs-owner.step.ts"
import { ParkPrice } from "./park-price.step.ts"

export class PriceOk extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.price.ok === true
    override readonly yes = NeedsOwner
    override readonly no = ParkPrice
}
