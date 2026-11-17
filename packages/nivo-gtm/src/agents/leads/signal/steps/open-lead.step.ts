import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { OpenLead as OpenLeadCell } from "../../common/open-lead.cell.ts"
import type { State } from "../signal.workflow.ts"
import { OkOpenLead } from "./ok-open-lead.step.ts"

export class OpenLead extends NodeRun(OpenLeadCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ ref: s.signals[0].contactRef, name: "", source: s.signals[0].source, note: s.signals[0].note })
    override readonly into = ["lead"] as const
    override readonly next = OkOpenLead
}
