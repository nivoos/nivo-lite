import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"

/** Ends the run with the reason `invited`: the invitation is sent; the lead's answer starts the second (pick) run. */
export class EndInvited extends NodeEnd<typeof State> {
    override readonly reason = "invited"
}
