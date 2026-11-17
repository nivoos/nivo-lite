import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"

export class EndInvited extends NodeEnd<typeof State> {
    override readonly reason = "invited"
}
