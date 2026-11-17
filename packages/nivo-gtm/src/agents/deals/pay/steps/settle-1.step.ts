import { NodeWait, take, Ended, type EndedItem } from "@starci/nivoos-sdk"
import type { State,  } from "../pay.workflow.ts"
import { Paid1 } from "./paid-1.step.ts"

/** The watch ended: paid, short or expired. */
export class Settle1 extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(Ended, {}, (s, ends: EndedItem[]) => {
            const [first] = ends
            if (first === undefined) return
            const output = first.output as { paid?: boolean; amount?: number; transferId?: string } | null
            s.result = { reason: first.reason ?? "", paid: output !== null && output.paid === true, amount: output !== null && typeof output.amount === "number" ? output.amount : 0, transferId: output !== null && typeof output.transferId === "string" ? output.transferId : "" }
        }),
    ]
    override readonly next = Paid1
}
