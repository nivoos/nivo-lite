import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../calendar-round.workflow.ts"

/** The week was approved and its publications are scheduled: the run ends. */
export class Scheduled extends NodeEnd<typeof State> {
    override readonly reason = "scheduled"
}
