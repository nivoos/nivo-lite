import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../publish.workflow.ts"

/** The final check found the post no longer true: it is not sent. */
export class Outdated extends NodeEnd<typeof State> {
    override readonly reason = "outdated"
}
