import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"

/** Ends the run with the reason `no_slots`: no free demo time is left to offer, so the booking stops without inviting. */
export class EndNoSlots extends NodeEnd<typeof State> {
    override readonly reason = "no_slots"
}
