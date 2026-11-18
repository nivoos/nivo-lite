import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../front.workflow.ts"

/** Ends the run with the reason `answered_ready`: the lead was answered and announced as ready, which starts the scoring. */
export class EndReady extends NodeEnd<typeof State> {
    override readonly reason = "answered_ready"
}
