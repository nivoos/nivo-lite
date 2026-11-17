import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import { Signal } from "./signal.step.ts"
import { Answer } from "./answer.step.ts"
import type { State } from "../replies.workflow.ts"

export class IsInterest extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.sorted.kind === "interest"
    override readonly label = { vi: "Quan tâm mua?", en: "Interested?" }
    override readonly yes = Signal
    override readonly no = Answer
}
