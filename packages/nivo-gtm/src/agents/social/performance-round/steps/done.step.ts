import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../performance-round.workflow.ts"

export class Done extends NodeEnd<typeof State> {
    override readonly reason = "done"
}
