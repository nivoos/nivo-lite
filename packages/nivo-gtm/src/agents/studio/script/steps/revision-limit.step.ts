import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../script.workflow.ts"

/** A person asked for more rewrites than `maxRevisions` allows: the item keeps its last script for a person to write by hand. */
export class RevisionLimit extends NodeEnd<typeof State> {
    override readonly reason = "revision_limit"
}
