import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../quote.workflow.ts"

/** The owner does not accept the discount; the sales person quotes again. */
export class OwnerDeclined extends NodeEnd<typeof State> {
    override readonly reason = "owner_declined"
}
