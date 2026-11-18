import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../qualify.workflow.ts"

/** Ends the run with the reason `scored`: the lead was scored but did not reach the qualified bar. */
export class EndScored extends NodeEnd<typeof State> {
    override readonly reason = "scored"
}
