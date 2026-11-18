import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"

/** Ends the run with the reason `outcome_pending`: the host has not said how the demo went yet; the outcome run picks it up later. */
export class EndOutcomePending extends NodeEnd<typeof State> {
    override readonly reason = "outcome_pending"
}
