import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { EmitDemoDone as EmitDemoDoneCell } from "../../common/emit-demo-done.cell.ts"
import type { State } from "../book-demo.workflow.ts"
import { EndDone } from "./end-done.step.ts"

export class EmitDemoDone extends NodeRun(EmitDemoDoneCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ leadId: s.leadId, code: s.slots.code, demoId: s.book.demoId, note: "Demo đã diễn ra" })
    override readonly into = ["emitted"] as const
    override readonly next = EndDone
}
