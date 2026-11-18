import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../front.workflow.ts"

/** Ends the run with the reason `answered`: the lead was answered and is not yet ready for a demo or a price. */
export class EndAnswered extends NodeEnd<typeof State> {
    override readonly reason = "answered"
}
