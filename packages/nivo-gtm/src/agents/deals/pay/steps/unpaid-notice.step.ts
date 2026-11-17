import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { PostPayNotice as PostPayNoticeCell } from "../../cells/post-pay-notice.cell.ts"
import type { State } from "../pay.workflow.ts"
import { Unpaid } from "./unpaid.step.ts"

/** Tells the sales room no money came after the reminder. */
export class UnpaidNotice extends NodeRun(PostPayNoticeCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ code: s.deal.code, kind: "unpaid" as const, amount: s.deal.amount, received: 0 })
    override readonly into = ["notified"] as const
    override readonly next = Unpaid
}
