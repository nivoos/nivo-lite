import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../front.workflow.ts"

/** Ends the run with the reason `spam`: the message is spam, so it is dropped without touching a lead. */
export class EndSpam extends NodeEnd<typeof State> {
    override readonly reason = "spam"
}
