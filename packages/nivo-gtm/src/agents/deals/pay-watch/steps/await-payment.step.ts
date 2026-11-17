import { NodeWait, take } from "@starci/nivoos-sdk"
import { SepayPaymentPaid } from "@starci/nivoos-provider-templates/sepay/payment-paid.cell"
import { SepayNivo } from "../../../../accounts/sepay-nivo.account.ts"
import type { State, Payment } from "../pay-watch.workflow.ts"
import { Check } from "./check.step.ts"
import { Expired } from "./expired.step.ts"

/** A transfer whose memo names the pay code, up to 72 hours (the wait's timeout is fixed in the workflow). */
export class AwaitPayment extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(SepayPaymentPaid, { account: SepayNivo }, (s, payments: Payment[]) => { const [first] = payments; if (first !== undefined) s.payment = first }),
    ]
    override readonly timeout = { hours: 72 }
    override readonly next = Check
    override readonly onTimeout = Expired
}
