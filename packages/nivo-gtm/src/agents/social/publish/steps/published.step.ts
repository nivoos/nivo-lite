import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../publish.workflow.ts"

/** The post is sent, recorded and announced: the run ends. */
export class Published extends NodeEnd<typeof State> {
    override readonly reason = "published"
}
