import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../signal.workflow.ts"

/** Ends the run with the reason `declined`: a send to a held route or an erased contact was refused, so the signal stops. */
export class EndDeclined extends NodeEnd<typeof State> {
    override readonly reason = "declined"
}
