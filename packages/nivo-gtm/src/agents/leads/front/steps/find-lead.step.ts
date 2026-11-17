import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { FindLead as FindLeadCell } from "../../common/find-lead.cell.ts"
import type { State } from "../front.workflow.ts"
import { IsKnown } from "./is-known.step.ts"

export class FindLead extends NodeRun(FindLeadCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ ref: s.messages[0].fromId })
    override readonly into = ["lead"] as const
    override readonly next = IsKnown
}
