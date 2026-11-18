import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../front.workflow.ts"

/** Ends the run with the reason `declined`: a send to a held route or an erased contact was refused, so the front door stays silent. */
export class EndDeclined extends NodeEnd<typeof State> {
    override readonly reason = "declined"
}
