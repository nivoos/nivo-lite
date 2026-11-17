import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../nurture.workflow.ts"

export class EndStopped extends NodeEnd<typeof State> {
    override readonly reason = "stopped"
}
