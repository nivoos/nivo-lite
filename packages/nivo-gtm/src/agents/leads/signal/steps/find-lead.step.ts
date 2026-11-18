import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { FindLead as FindLeadCell } from "../../common/find-lead.cell.ts"
import type { State } from "../signal.workflow.ts"
import { IsKnown } from "./is-known.step.ts"

/** Runs `FindLead` (a lead as the workflows route on it: whether it exists, its object id and code, where it stands, whether it may be written to) and keeps its result in `lead`; the run then goes to `IsKnown`. */
export class FindLead extends NodeRun(FindLeadCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ ref: s.signals[0].contactRef })
    override readonly into = ["lead"] as const
    override readonly next = IsKnown
}
