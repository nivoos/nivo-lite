import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"

export class EndDone extends NodeEnd<typeof State> {
    override readonly reason = "demo_done"
}
