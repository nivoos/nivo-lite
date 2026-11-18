import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { EmitSlotChosen as EmitSlotChosenCell } from "../../common/emit-slot-chosen.cell.ts"
import type { State } from "../front.workflow.ts"
import { EndSlot } from "./end-slot.step.ts"

/** Runs `EmitSlotChosen` (hands the lead's answer to the demo booking: one act, `events.emit` of `SlotChosen` with the words they wrote) and keeps its result in `emitted`; the run then goes to `EndSlot`. */
export class EmitSlot extends NodeRun(EmitSlotChosenCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        leadId: s.lead.leadId,
        code: s.lead.code,
        messages: s.messages,
        email: s.understood.email,
    })
    override readonly into = ["emitted"] as const
    override readonly next = EndSlot
}
