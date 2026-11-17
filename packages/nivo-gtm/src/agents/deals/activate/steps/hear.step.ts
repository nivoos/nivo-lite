import { NodeWait, take } from "@starci/nivoos-sdk"
import { DealPaid } from "../../../../common/events/deal-paid.event.ts"
import type { State, Paid } from "../activate.workflow.ts"
import { Read } from "./read.step.ts"

/** The start: a deal was paid. */
export class Hear extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(DealPaid, {}, (s, paid: Paid[]) => { const [first] = paid; if (first !== undefined) s.event = first }),
    ]
    override readonly next = Read
}
