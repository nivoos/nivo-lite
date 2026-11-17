import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../signal.workflow.ts"
import { SendOpener } from "./send-opener.step.ts"
import { Retry } from "./retry.step.ts"

export class OkOpener extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.opener.refusal === ""
    override readonly yes = SendOpener
    override readonly no = Retry
}
