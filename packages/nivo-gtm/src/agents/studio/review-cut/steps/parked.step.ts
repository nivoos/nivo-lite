import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../review-cut.workflow.ts"

/** No one reviewed the cut: the item is parked and ONE alert card was posted. */
export class Parked extends NodeEnd<typeof State> {
    override readonly reason = "parked"
}
