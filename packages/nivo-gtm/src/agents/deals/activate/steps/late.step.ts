import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../activate.workflow.ts"

/** The activator did not answer in a day; the activation card stays in the room. */
export class Late extends NodeEnd<typeof State> {
    override readonly reason = "late"
}
