import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import { Report } from "./report.step.ts"
import { Done } from "./done.step.ts"
import type { State } from "../performance-round.workflow.ts"

export class IsMonday extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.pull.isMonday === true
    override readonly label = { vi: "Thứ Hai?", en: "Monday?" }
    override readonly yes = Report
    override readonly no = Done
}
