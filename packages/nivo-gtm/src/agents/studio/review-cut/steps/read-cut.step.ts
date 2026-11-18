import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioReadCut as ReadCutCell } from "../read-cut.cell.ts"
import { CheckCut } from "./check-cut.step.ts"
import type { State } from "../review-cut.workflow.ts"

/** Reads the content item with its approved script and the cut with its link, plus the public price document. */
export class ReadCut extends NodeRun(ReadCutCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ contentId: s.cut.contentId, cutId: s.cut.cutId })
    override readonly into = ["ctx"] as const
    override readonly next = CheckCut
}
