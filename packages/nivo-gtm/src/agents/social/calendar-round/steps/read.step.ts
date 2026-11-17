import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialCalendarRead as ReadCell } from "../read.cell.ts"
import { HasItems } from "./has-items.step.ts"
import type { State } from "../calendar-round.workflow.ts"

export class Read extends NodeRun(ReadCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ instant: s.tick.instant })
    override readonly into = ["read"] as const
    override readonly next = HasItems
}
