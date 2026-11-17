import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../review-cut.workflow.ts"

/** The cut goes back to the editor: the `produce` run gives a new date and waits for the next cut. */
export class SentBack extends NodeEnd<typeof State> {
    override readonly reason = "fix"
}
