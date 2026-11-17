import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../idea-round.workflow.ts"

/** The ideas are filed and the card is in the room; the person's answer opens the `pick` workflow. */
export class Done extends NodeEnd<typeof State> {
    override readonly reason = "ideas-posted"
}
