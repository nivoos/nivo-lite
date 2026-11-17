import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../handover.workflow.ts"

/** The sales person chose to quote later; the deal waits in proposal with its next action. */
export class Held extends NodeEnd<typeof State> {
    override readonly reason = "held"
}
