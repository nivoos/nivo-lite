import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../nurture.workflow.ts"

/** Ends the run with the reason `declined`: a send to a held route or an erased contact was refused, so follow-ups stop. */
export class EndDeclined extends NodeEnd<typeof State> {
    override readonly reason = "declined"
}
