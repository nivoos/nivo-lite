import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../handover.workflow.ts"
import { SetPlan } from "./set-plan.step.ts"
import { Held } from "./held.step.ts"

export class Wants extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.answer.choice === "quote"
    override readonly yes = SetPlan
    override readonly no = Held
}
