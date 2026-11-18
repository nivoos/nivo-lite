import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../front.workflow.ts"

/** Ends the run with the reason `slot_chosen`: the lead picked a demo time and the pick was handed to the booking (`SlotChosen`). */
export class EndSlot extends NodeEnd<typeof State> {
    override readonly reason = "slot_chosen"
}
