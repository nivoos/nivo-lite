import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../nurture.workflow.ts"
import { Draft } from "./draft.step.ts"
import { Resume2 } from "./resume2.step.ts"

export class Resume1 extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.draft.refusal !== undefined && s.draft.refusal !== ""
    override readonly yes = Draft
    override readonly no = Resume2
}
