import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../publish.workflow.ts"

/** The publication was cancelled before its time: nothing is sent, the run ends. */
export class Cancelled extends NodeEnd<typeof State> {
    override readonly reason = "cancelled"
}
