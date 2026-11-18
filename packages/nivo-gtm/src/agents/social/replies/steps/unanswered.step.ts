import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../replies.workflow.ts"

/** No public answer exists: nothing is sent and the run ends. */
export class Unanswered extends NodeEnd<typeof State> {
    override readonly reason = "unanswered"
}
