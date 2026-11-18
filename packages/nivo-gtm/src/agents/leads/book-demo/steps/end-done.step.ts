import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"

/** Ends the run with the reason `demo_done`: the demo happened and `DemoDone` has been announced. */
export class EndDone extends NodeEnd<typeof State> {
    override readonly reason = "demo_done"
}
