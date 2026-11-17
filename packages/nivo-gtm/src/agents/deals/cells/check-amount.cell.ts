import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"

export const CheckAmountInput = z.strictObject({ expected: z.number().int().min(0), paid: z.number().min(0) })
export const CheckAmountOutput = z.strictObject({ short: z.boolean(), difference: z.number() })

type In = z.infer<typeof CheckAmountInput>
type Out = z.infer<typeof CheckAmountOutput>

/**
 * `nivo-gtm.check-amount` (So số tiền nhận): the transfer carries the right pay code; this cell says whether the money is enough. `short` is true when less than the deal's amount arrived (a person decides:
 * the watch ends `short`); equal or more is paid. Pure logic: no act.
 */
export class CheckAmount implements Node<typeof CheckAmountInput, typeof CheckAmountOutput> {
    readonly key = keyOf("check-amount")
    readonly version = 1
    readonly title = { vi: "So số tiền nhận", en: "Check the amount received" }
    readonly input = CheckAmountInput
    readonly output = CheckAmountOutput
    readonly reads = []

    run(input: In, _reach: NodeReach): Out {
        return { short: input.paid < input.expected, difference: input.paid - input.expected }
    }
}
