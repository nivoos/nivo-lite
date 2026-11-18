import { NodeEnd, type StateOf } from "@starci/nivoos-sdk"
import { PayWatchOutput, type State } from "../pay-watch.workflow.ts"

/** No transfer in time. */
export class Expired extends NodeEnd<typeof State> {
    override readonly reason = "expired"
    override readonly output = (s: StateOf<typeof State>) => ({ paid: false, amount: 0, transferId: "" })
    override readonly outputSchema = PayWatchOutput
}
