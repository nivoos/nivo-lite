import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../front.workflow.ts"
import { EndSpam } from "./end-spam.step.ts"
import { Touch } from "./touch.step.ts"

export class IsSpam extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.understood.intent === "spam"
    override readonly yes = EndSpam
    override readonly no = Touch
}
