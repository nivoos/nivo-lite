import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../calendar-round.workflow.ts"

/** No approved content is waiting: no week to plan. */
export class NothingToPlan extends NodeEnd<typeof State> {
    override readonly reason = "nothing-to-plan"
}
