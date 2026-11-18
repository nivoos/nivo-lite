import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../qualify.workflow.ts"

/** Ends the run with the reason `qualified`: the score qualified the lead and `LeadQualified` has been announced. */
export class EndQualified extends NodeEnd<typeof State> {
    override readonly reason = "qualified"
}
