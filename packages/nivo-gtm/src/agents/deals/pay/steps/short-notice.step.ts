import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { PostPayNotice as PostPayNoticeCell } from "../../cells/post-pay-notice.cell.ts"
import type { State } from "../pay.workflow.ts"
import { Short } from "./short.step.ts"

/** Tells the sales room the transfer was short. */
export class ShortNotice extends NodeRun(PostPayNoticeCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        code: s.deal.code,
        kind: "short" as const,
        amount: s.deal.amount,
        received: s.result.amount,
    })
    override readonly into = ["notified"] as const
    override readonly next = Short
}
