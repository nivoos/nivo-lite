import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../review-cut.workflow.ts"

/** The cut is approved and announced: the Social agent plans it. */
export class Approved extends NodeEnd<typeof State> {
    override readonly reason = "approved"
}
