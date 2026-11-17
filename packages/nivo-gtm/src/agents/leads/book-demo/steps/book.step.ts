import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { Book as BookCell } from "../book.cell.ts"
import type { State } from "../book-demo.workflow.ts"
import { OkBook } from "./ok-book.step.ts"

export class Book extends NodeRun(BookCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ leadId: s.leadId, slots: s.slots.slots, index: s.pick.index })
    override readonly into = ["book"] as const
    override readonly next = OkBook
}
