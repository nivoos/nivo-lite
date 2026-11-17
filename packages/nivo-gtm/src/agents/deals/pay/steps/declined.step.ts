import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../pay.workflow.ts"

/** A person declined the send of the payment details. */
export class Declined extends NodeEnd<typeof State> {
    override readonly reason = "declined"
}
