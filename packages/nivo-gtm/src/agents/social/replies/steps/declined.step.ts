import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../replies.workflow.ts"

/** The person declined to send the reply: nothing is sent, the run ends. */
export class Declined extends NodeEnd<typeof State> {
    override readonly reason = "declined"
}
