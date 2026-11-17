import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import { Plan } from "./plan.step.ts"
import { NothingToPlan } from "./nothing-to-plan.step.ts"
import type { State } from "../calendar-round.workflow.ts"

export class HasItems extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.read.items.length > 0
    override readonly label = { vi: "Có nội dung đã duyệt?", en: "Anything approved?" }
    override readonly yes = Plan
    override readonly no = NothingToPlan
}
