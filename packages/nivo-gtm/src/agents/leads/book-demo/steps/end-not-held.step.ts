import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"

/** Ends the run with the reason `demo_not_held`: the host reported the demo as not held (no show or moved), so the lead is not advanced. */
export class EndNotHeld extends NodeEnd<typeof State> {
    override readonly reason = "demo_not_held"
}
