import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { AskOwner as AskOwnerCell } from "../../cells/ask-owner.cell.ts"
import type { State } from "../quote.workflow.ts"
import { OwnerAnswer } from "./owner-answer.step.ts"

/** Asks the owner to approve a discount above the line they set, with the price lines in the card. */
export class AskOwner extends NodeRun(AskOwnerCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        code: s.deal.code,
        discountPercent: s.price.discountPercent,
        amount: s.price.amount,
        lines: s.price.lines,
    })
    override readonly into = ["asked"] as const
    override readonly next = OwnerAnswer
}
