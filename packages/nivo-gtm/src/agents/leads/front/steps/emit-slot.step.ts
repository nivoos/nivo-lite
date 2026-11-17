import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { EmitSlotChosen as EmitSlotChosenCell } from "../../common/emit-slot-chosen.cell.ts"
import type { State } from "../front.workflow.ts"
import { EndSlot } from "./end-slot.step.ts"

export class EmitSlot extends NodeRun(EmitSlotChosenCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ leadId: s.lead.leadId, code: s.lead.code, messages: s.messages, email: s.understood.email })
    override readonly into = ["emitted"] as const
    override readonly next = EndSlot
}
