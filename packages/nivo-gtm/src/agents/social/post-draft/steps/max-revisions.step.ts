import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../post-draft.workflow.ts"

/** The post was rewritten as many times as the cap allows and the reviewer still wanted another. */
export class MaxRevisions extends NodeEnd<typeof State> {
    override readonly reason = "max_revisions"
}
