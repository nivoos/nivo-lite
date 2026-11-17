import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { ReadDeal as ReadDealCell } from "../../cells/read-deal.cell.ts"
import type { State } from "../pay.workflow.ts"
import { WriteCode } from "./write-code.step.ts"

export class Read extends NodeRun(ReadDealCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ dealId: s.change.objectId })
    override readonly into = ["deal"] as const
    override readonly next = WriteCode
}
