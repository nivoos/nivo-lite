import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { EmitDemoDone as EmitDemoDoneCell } from "../../common/emit-demo-done.cell.ts"
import type { State } from "../book-demo.workflow.ts"
import { EndDone } from "./end-done.step.ts"

/** Runs `EmitDemoDone` (says the demo was held: one act, `events.emit` of `DemoDone` on the subject `lead:<code>`, keyed by the demo (Deals opens the deal from it)) and keeps its result in `emitted`; the run then goes to `EndDone`. */
export class EmitDemoDone extends NodeRun(EmitDemoDoneCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        leadId: s.leadId,
        code: s.slots.code,
        demoId: s.book.demoId,
        note: "Demo đã diễn ra",
    })
    override readonly into = ["emitted"] as const
    override readonly next = EndDone
}
