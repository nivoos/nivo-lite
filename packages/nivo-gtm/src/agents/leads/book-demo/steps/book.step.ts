import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { Book as BookCell } from "../book.cell.ts"
import type { State } from "../book-demo.workflow.ts"
import { SendConfirm } from "./send-confirm.step.ts"

/** Runs `Book` (the demo as the rest of the workflow needs it: its id, the instants it waits on (ms since the epoch), who hosts it, the link and how a person reads its time) and keeps its result in `book`; the run then goes to `SendConfirm`. */
export class Book extends NodeRun(BookCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        leadId: s.leadId,
        slots: s.slots.slots,
        index: s.pick.index,
    })
    override readonly into = ["book"] as const
    override readonly next = SendConfirm
}
