import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../qualify.workflow.ts"
import { IsQualified } from "./is-qualified.step.ts"
import { Retry } from "./retry.step.ts"

export class OkSave extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.saved.refusal === ""
    override readonly yes = IsQualified
    override readonly no = Retry
}
