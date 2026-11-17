import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../post-draft.workflow.ts"

export class Approved extends NodeEnd<typeof State> {
    override readonly reason = "approved"
}
