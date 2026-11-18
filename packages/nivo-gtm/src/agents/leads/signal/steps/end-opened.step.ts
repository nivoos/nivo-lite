import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../signal.workflow.ts"

/** Ends the run with the reason `opened`: the opener was sent to the lead. */
export class EndOpened extends NodeEnd<typeof State> {
    override readonly reason = "opened"
}
