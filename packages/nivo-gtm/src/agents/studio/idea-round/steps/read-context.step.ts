import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioReadContext as ReadContextCell } from "../read-context.cell.ts"
import { Ideas } from "./ideas.step.ts"
import type { State } from "../idea-round.workflow.ts"

/** Reads the context of the week from the Monday tick: brain answers, last weeks' metrics and the open ideas. */
export class ReadContext extends NodeRun(ReadContextCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ instant: s.tick.instant })
    override readonly into = ["context"] as const
    override readonly next = Ideas
}
