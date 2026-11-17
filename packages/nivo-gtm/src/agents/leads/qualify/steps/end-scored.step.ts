import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../qualify.workflow.ts"

export class EndScored extends NodeEnd<typeof State> {
    override readonly reason = "scored"
}
