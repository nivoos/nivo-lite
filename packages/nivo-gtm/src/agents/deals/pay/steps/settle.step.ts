import { NodeWait, take, Ended } from "@starci/nivoos-sdk"
import { PayWatch } from "../../pay-watch/pay-watch.workflow.ts"
import type { State } from "../pay.workflow.ts"
import { IsPaid } from "./is-paid.step.ts"

/** The watch ended: paid, short or expired. Its end is typed from the `output` the watch workflow declares. */
export class Settle extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State, typeof PayWatch>(Ended, { of: PayWatch }, (s, ends) => {
            const [first] = ends
            if (first === undefined) return
            s.result = { reason: first.reason ?? "", paid: first.output?.paid ?? false, amount: first.output?.amount ?? 0, transferId: first.output?.transferId ?? "" }
        }),
    ]
    override readonly next = IsPaid
}
