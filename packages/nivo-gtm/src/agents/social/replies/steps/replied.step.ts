import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../replies.workflow.ts"

/** The reply was sent: the run ends. */
export class Replied extends NodeEnd<typeof State> {
    override readonly reason = "replied"
}
