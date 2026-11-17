import { NodeEnd, type StateOf } from "@starci/nivoos-sdk"
import { PayWatchOutput } from "../pay-watch.workflow.ts"
import type { State } from "../pay-watch.workflow.ts"

/** The right code but less money. */
export class Short extends NodeEnd<typeof State> {
    override readonly reason = "short"
    override readonly output = (s: StateOf<typeof State>) => ({ paid: false, amount: s.payment === undefined ? 0 : s.payment.amount, transferId: s.payment === undefined ? "" : s.payment.transferId })
    override readonly outputSchema = PayWatchOutput
}
