import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { ReadDeal as ReadDealCell } from "../../cells/read-deal.cell.ts"
import type { State } from "../activate.workflow.ts"
import { Request } from "./request.step.ts"

export class Read extends NodeRun(ReadDealCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ dealId: s.event.dealId })
    override readonly into = ["deal"] as const
    override readonly next = Request
}
