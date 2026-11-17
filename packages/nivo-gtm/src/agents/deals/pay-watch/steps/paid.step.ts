import { NodeEnd, type StateOf } from "@starci/nivoos-sdk"
import { PayWatchOutput } from "../pay-watch.workflow.ts"
import type { State } from "../pay-watch.workflow.ts"

/** The money is at least the amount. */
export class Paid extends NodeEnd<typeof State> {
    override readonly reason = "paid"
    override readonly output = (s: StateOf<typeof State>) => ({ paid: true, amount: s.payment === undefined ? 0 : s.payment.amount, transferId: s.payment === undefined ? "" : s.payment.transferId })
    override readonly outputSchema = PayWatchOutput
}
