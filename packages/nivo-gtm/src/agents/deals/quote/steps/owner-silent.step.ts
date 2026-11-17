import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../quote.workflow.ts"

/** The owner did not answer about the discount in a day; the sales person asks directly and fills the plan again. */
export class OwnerSilent extends NodeEnd<typeof State> {
    override readonly reason = "owner_silent"
}
