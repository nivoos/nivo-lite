import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { ReadDeal as ReadDealCell } from "../../cells/read-deal.cell.ts"
import type { State } from "../quote.workflow.ts"
import { Price } from "./price.step.ts"

/** Reads the deal that moved to the quote stage, so the price is computed from its plan, months and credit pack. */
export class Read extends NodeRun(ReadDealCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ dealId: s.change.objectId })
    override readonly into = ["deal"] as const
    override readonly next = Price
}
