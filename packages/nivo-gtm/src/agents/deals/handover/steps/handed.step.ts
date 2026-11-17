import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../handover.workflow.ts"

/** The plan is filled; the quote takes over. */
export class Handed extends NodeEnd<typeof State> {
    override readonly reason = "handed"
}
