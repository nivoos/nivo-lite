import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../signal.workflow.ts"
import { EndDoNotContact } from "./end-do-not-contact.step.ts"
import { Opener } from "./opener.step.ts"

/** Branches on `lead.doNotContact === true`: when it holds the run goes to `EndDoNotContact`, otherwise to `Opener`. */
export class IsReachable extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.lead.doNotContact === true
    override readonly yes = EndDoNotContact
    override readonly no = Opener
}
