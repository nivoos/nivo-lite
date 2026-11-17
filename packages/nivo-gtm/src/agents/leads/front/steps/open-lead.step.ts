import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { OpenLead as OpenLeadCell } from "../../common/open-lead.cell.ts"
import type { State } from "../front.workflow.ts"
import { Understand } from "./understand.step.ts"

export class OpenLead extends NodeRun(OpenLeadCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ ref: s.messages[0].fromId, name: s.messages[0].fromName, source: "telegram", note: "" })
    override readonly into = ["lead"] as const
    override readonly next = Understand
}
