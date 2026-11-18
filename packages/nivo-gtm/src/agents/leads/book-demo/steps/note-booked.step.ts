import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SetStage as SetStageCell } from "../../common/set-stage.cell.ts"
import type { State } from "../book-demo.workflow.ts"
import { WaitRemind } from "./wait-remind.step.ts"

/** Runs `SetStage` (the instant the next action falls due (ms since the epoch); 0 means `nextAfterHours` from now) and keeps its result in `staged`; the run then goes to `WaitRemind`. */
export class NoteBooked extends NodeRun(SetStageCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        leadId: s.leadId,
        stage: "demo_booked" as const,
        nextAction: "Demo đã hẹn",
        nextAtMs: s.book.atMs,
        nextAfterHours: 0,
    })
    override readonly into = ["staged"] as const
    override readonly next = WaitRemind
}
