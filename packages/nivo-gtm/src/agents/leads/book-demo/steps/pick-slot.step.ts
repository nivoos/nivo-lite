import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { PickSlot as PickSlotCell } from "../pick-slot.cell.ts"
import type { State } from "../book-demo.workflow.ts"
import { OkPickSlot } from "./ok-pick-slot.step.ts"

export class PickSlot extends NodeRun(PickSlotCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ text: s.choiceText, emailHint: s.choiceEmail, labels: s.slots.labels })
    override readonly into = ["pick"] as const
    override readonly next = OkPickSlot
}
