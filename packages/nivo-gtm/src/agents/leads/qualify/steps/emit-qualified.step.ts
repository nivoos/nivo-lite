import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { EmitLeadQualified as EmitLeadQualifiedCell } from "../../common/emit-lead-qualified.cell.ts"
import type { State } from "../qualify.workflow.ts"
import { EndQualified } from "./end-qualified.step.ts"

export class EmitQualified extends NodeRun(EmitLeadQualifiedCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ leadId: s.saved.leadId, code: s.saved.code, score: s.saved.score })
    override readonly into = ["emitted"] as const
    override readonly next = EndQualified
}
