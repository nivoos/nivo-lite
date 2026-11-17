import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../script.workflow.ts"

/** The item is parked with its next action filled; a person moves its status back to wake it. */
export class Parked extends NodeEnd<typeof State> {
    override readonly reason = "parked"
}
