import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { Slots as SlotsCell } from "../slots.cell.ts"
import type { State } from "../book-demo.workflow.ts"
import { HasSlots } from "./has-slots.step.ts"

export class Slots extends NodeRun(SlotsCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ leadId: s.leadId, phase: s.phase })
    override readonly into = ["slots"] as const
    override readonly next = HasSlots
}
