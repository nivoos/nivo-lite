import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../nurture.workflow.ts"
import { SendFollowUp } from "./send-follow-up.step.ts"
import { Retry } from "./retry.step.ts"

export class OkDraft extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.draft.refusal === ""
    override readonly yes = SendFollowUp
    override readonly no = Retry
}
