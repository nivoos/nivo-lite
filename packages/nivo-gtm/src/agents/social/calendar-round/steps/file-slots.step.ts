import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialFileSlots as FileSlotsCell } from "../file-slots.cell.ts"
import { Mirror } from "./mirror.step.ts"
import type { State } from "../calendar-round.workflow.ts"

export class FileSlots extends NodeRun(FileSlotsCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ instant: s.read.instant, slots: s.plan.slots })
    override readonly into = ["filed"] as const
    override readonly next = Mirror
}
