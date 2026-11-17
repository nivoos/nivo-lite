import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"

export class EndNotHeld extends NodeEnd<typeof State> {
    override readonly reason = "demo_not_held"
}
