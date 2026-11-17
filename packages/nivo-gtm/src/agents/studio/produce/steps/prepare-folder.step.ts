import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioPrepareFolder as PrepareFolderCell } from "../prepare-folder.cell.ts"
import { ShotList } from "./shot-list.step.ts"
import type { State } from "../produce.workflow.ts"

export class PrepareFolder extends NodeRun(PrepareFolderCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ objectId: s.change.objectId })
    override readonly into = ["folder"] as const
    override readonly next = ShotList
}
