import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../replies.workflow.ts"

/** The message is spam: it gets no answer and the run ends. */
export class Spam extends NodeEnd<typeof State> {
    override readonly reason = "spam"
}
