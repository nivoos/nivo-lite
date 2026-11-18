import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { Slots as SlotsCell } from "../slots.cell.ts"
import type { State } from "../book-demo.workflow.ts"
import { HasSlots } from "./has-slots.step.ts"

/** Runs `Slots` (`found` false: no invitation to make (`reason` says why)) and keeps its result in `slots`; the run then goes to `HasSlots`. */
export class Slots extends NodeRun(SlotsCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ leadId: s.leadId, phase: s.phase })
    override readonly into = ["slots"] as const
    override readonly next = HasSlots
}
