import { NodeWait, take } from "@starci/nivoos-sdk"
import { PayRequested } from "../../../../common/events/pay-requested.event.ts"
import type { State, Request } from "../pay-watch.workflow.ts"
import { AwaitPayment } from "./await-payment.step.ts"

/** The start: the deal asked for its payment. */
export class Hear extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(PayRequested, {}, (s, requests: Request[]) => { const [first] = requests; if (first !== undefined) s.request = first }),
    ]
    override readonly next = AwaitPayment
}
