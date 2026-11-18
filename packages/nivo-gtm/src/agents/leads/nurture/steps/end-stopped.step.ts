import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../nurture.workflow.ts"

/** Ends the run with the reason `stopped`: the lead no longer needs follow-up (its stage moved on), so the run stops. */
export class EndStopped extends NodeEnd<typeof State> {
    override readonly reason = "stopped"
}
