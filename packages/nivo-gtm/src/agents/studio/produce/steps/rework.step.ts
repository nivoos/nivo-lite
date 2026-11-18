import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioRework as ReworkCell } from "../rework.cell.ts"
import { WaitCut } from "./wait-cut.step.ts"
import type { State } from "../produce.workflow.ts"

/** Tells the editor what to fix in a cut a person sent back and gives the new due and reminder times. */
export class Rework extends NodeRun(ReworkCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ objectId: s.change.objectId })
    override readonly into = ["assigned"] as const
    override readonly next = WaitCut
}
