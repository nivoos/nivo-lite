import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../front.workflow.ts"

/** Ends the run with the reason `support`: the customer needs help and the team was notified instead of the sales answer. */
export class EndSupport extends NodeEnd<typeof State> {
    override readonly reason = "support"
}
