import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../front.workflow.ts"

export class EndNoAnswer extends NodeEnd<typeof State> {
    override readonly reason = "no_answer"
}
