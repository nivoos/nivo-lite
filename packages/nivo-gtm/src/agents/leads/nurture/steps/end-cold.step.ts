import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../nurture.workflow.ts"

/** Ends the run with the reason `cold`: the lead was parked as cold after the last follow-up got no answer. */
export class EndCold extends NodeEnd<typeof State> {
    override readonly reason = "cold"
}
