import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../pay-watch.workflow.ts"
import { Short } from "./short.step.ts"
import { Paid } from "./paid.step.ts"

/** Branches on the amount check: a transfer below the deal amount is short, otherwise the deal is paid. */
export class ShortCheck extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.check.short === true
    override readonly yes = Short
    override readonly no = Paid
}
