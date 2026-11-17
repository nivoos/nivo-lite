import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialKpiSheet as SheetCell } from "../sheet.cell.ts"
import { Done } from "./done.step.ts"
import type { State } from "../performance-round.workflow.ts"

export class Sheet extends NodeRun(SheetCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ instant: s.pull.instant, totals: s.pull.totals })
    override readonly into = ["sheet"] as const
    override readonly next = Done
}
