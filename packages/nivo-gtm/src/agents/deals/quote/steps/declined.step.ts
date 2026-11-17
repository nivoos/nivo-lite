import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../quote.workflow.ts"

/** A person declined the send of the quote. */
export class Declined extends NodeEnd<typeof State> {
    override readonly reason = "declined"
}
