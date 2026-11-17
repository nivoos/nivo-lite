import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../signal.workflow.ts"
import { IsReachable } from "./is-reachable.step.ts"
import { Retry } from "./retry.step.ts"

export class OkOpenLead extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.lead.refusal === ""
    override readonly yes = IsReachable
    override readonly no = Retry
}
