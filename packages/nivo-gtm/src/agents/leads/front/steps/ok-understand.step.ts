import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../front.workflow.ts"
import { IsSpam } from "./is-spam.step.ts"
import { Retry } from "./retry.step.ts"

export class OkUnderstand extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.understood.refusal === ""
    override readonly yes = IsSpam
    override readonly no = Retry
}
