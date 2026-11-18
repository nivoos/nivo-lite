import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../signal.workflow.ts"

/** Ends the run with the reason `do_not_contact`: the lead asked not to be contacted, so no opener is sent. */
export class EndDoNotContact extends NodeEnd<typeof State> {
    override readonly reason = "do_not_contact"
}
