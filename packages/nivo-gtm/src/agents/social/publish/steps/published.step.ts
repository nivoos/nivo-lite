import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../publish.workflow.ts"

export class Published extends NodeEnd<typeof State> {
    override readonly reason = "published"
}
