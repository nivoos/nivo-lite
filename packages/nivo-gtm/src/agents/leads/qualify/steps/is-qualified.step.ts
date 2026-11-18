import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../qualify.workflow.ts"
import { EmitQualified } from "./emit-qualified.step.ts"
import { EndScored } from "./end-scored.step.ts"

/** Branches on `saved.qualified === true`: when it holds the run goes to `EmitQualified`, otherwise to `EndScored`. */
export class IsQualified extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.saved.qualified === true
    override readonly yes = EmitQualified
    override readonly no = EndScored
}
