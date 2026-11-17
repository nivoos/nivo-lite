import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"

export class EndNoSlots extends NodeEnd<typeof State> {
    override readonly reason = "no_slots"
}
