import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { RecordDemo as RecordDemoCell } from "../record-demo.cell.ts"
import type { State } from "../book-demo.workflow.ts"
import { OkRecordDemo } from "./ok-record-demo.step.ts"

export class RecordDemo extends NodeRun(RecordDemoCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ demoId: s.book.demoId, choice: s.answers[0].choice })
    override readonly into = ["recorded"] as const
    override readonly next = OkRecordDemo
}
