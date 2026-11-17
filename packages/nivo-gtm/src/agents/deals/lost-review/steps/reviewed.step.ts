import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../lost-review.workflow.ts"

/** The review is posted. */
export class Reviewed extends NodeEnd<typeof State> {
    override readonly reason = "reviewed"
}
