import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../post-draft.workflow.ts"

/** The post is approved and announced: the run ends. */
export class Approved extends NodeEnd<typeof State> {
    override readonly reason = "approved"
}
