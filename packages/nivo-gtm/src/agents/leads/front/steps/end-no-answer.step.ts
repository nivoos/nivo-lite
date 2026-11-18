import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../front.workflow.ts"

/** Ends the run with the reason `no_answer`: the public brain has no answer, so the question went to the team instead. */
export class EndNoAnswer extends NodeEnd<typeof State> {
    override readonly reason = "no_answer"
}
