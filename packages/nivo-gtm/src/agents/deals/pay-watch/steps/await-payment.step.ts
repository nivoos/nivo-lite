import { NodeWait, fromSetting, take } from "@starci/nivoos-sdk"
import { SepayPaymentPaid } from "@starci/nivoos-provider-templates/sepay/payment-paid.cell"
import { UpdateDeal } from "../../cells/update-deal.cell.ts"
import { SepayNivo } from "../../../../accounts/sepay-nivo.account.ts"
import type { State, Payment } from "../pay-watch.workflow.ts"
import { Check } from "./check.step.ts"
import { Expired } from "./expired.step.ts"

/** A transfer whose memo names the pay code, up to the hours of the deal setting `unpaidHours` (72 by default): the same time the deal's due date is set by. */
export class AwaitPayment extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(SepayPaymentPaid, { account: SepayNivo }, (s, payments: Array<Payment>) => {
            const first = payments.at(0)
            if (first !== undefined) s.payment = first
        }),
    ]
    override readonly timeout = fromSetting(UpdateDeal, "unpaidHours", "hours")
    override readonly next = Check
    override readonly onTimeout = Expired
}
