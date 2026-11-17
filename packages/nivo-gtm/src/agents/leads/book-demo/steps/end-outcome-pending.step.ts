import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"

export class EndOutcomePending extends NodeEnd<typeof State> {
    override readonly reason = "outcome_pending"
}
