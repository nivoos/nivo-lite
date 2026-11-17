import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { FindLead as FindLeadCell } from "../../common/find-lead.cell.ts"
import type { State } from "../signal.workflow.ts"
import { IsKnown } from "./is-known.step.ts"

export class FindLead extends NodeRun(FindLeadCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ ref: s.signals[0].contactRef })
    override readonly into = ["lead"] as const
    override readonly next = IsKnown
}
