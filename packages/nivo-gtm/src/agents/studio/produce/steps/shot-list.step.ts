import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioShotList as ShotListCell } from "../shot-list.cell.ts"
import { Assign } from "./assign.step.ts"
import type { State } from "../produce.workflow.ts"

/** Writes the shot list and the teleprompter text from the approved script. */
export class ShotList extends NodeRun(ShotListCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ objectId: s.change.objectId })
    override readonly into = ["shots"] as const
    override readonly next = Assign
}
