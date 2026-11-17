import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioRework as ReworkCell } from "../rework.cell.ts"
import { WaitCut } from "./wait-cut.step.ts"
import type { State } from "../produce.workflow.ts"

export class Rework extends NodeRun(ReworkCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ objectId: s.change.objectId })
    override readonly into = ["assigned"] as const
    override readonly next = WaitCut
}
