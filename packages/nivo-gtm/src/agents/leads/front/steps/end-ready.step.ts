import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../front.workflow.ts"

export class EndReady extends NodeEnd<typeof State> {
    override readonly reason = "answered_ready"
}
