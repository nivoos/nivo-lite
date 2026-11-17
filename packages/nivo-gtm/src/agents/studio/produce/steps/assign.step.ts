import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioAssign as AssignCell } from "../assign.cell.ts"
import { PostBrief } from "./post-brief.step.ts"
import type { State } from "../produce.workflow.ts"

export class Assign extends NodeRun(AssignCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ folder: s.folder, shots: s.shots })
    override readonly into = ["assigned"] as const
    override readonly next = PostBrief
}
