import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SetStage as SetStageCell } from "../../common/set-stage.cell.ts"
import type { State } from "../book-demo.workflow.ts"
import { OkNoteBooked } from "./ok-note-booked.step.ts"

export class NoteBooked extends NodeRun(SetStageCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ leadId: s.leadId, stage: "demo_booked" as const, nextAction: "Demo đã hẹn", nextAtMs: s.book.atMs, nextAfterHours: 0 })
    override readonly into = ["staged"] as const
    override readonly next = OkNoteBooked
}
