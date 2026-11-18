import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { RecordDemo as RecordDemoCell } from "../record-demo.cell.ts"
import type { State } from "../book-demo.workflow.ts"
import { SetLeadStage } from "./set-lead-stage.step.ts"

/** Runs `RecordDemo` (what the outcome means for the lead: the stage it goes to and the next action it gets) and keeps its result in `recorded`; the run then goes to `SetLeadStage`. */
export class RecordDemo extends NodeRun(RecordDemoCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ demoId: s.book.demoId, choice: s.answers[0].choice })
    override readonly into = ["recorded"] as const
    override readonly next = SetLeadStage
}
