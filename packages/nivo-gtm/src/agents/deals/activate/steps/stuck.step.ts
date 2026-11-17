import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../activate.workflow.ts"

/** The activator answered that the plan could not be activated yet. */
export class Stuck extends NodeEnd<typeof State> {
    override readonly reason = "stuck"
}
