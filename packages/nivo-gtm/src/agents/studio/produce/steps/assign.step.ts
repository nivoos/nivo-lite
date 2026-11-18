import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioAssign as AssignCell } from "../assign.cell.ts"
import { PostBrief } from "./post-brief.step.ts"
import type { State } from "../produce.workflow.ts"

/** Gives the production to the editor: moves the item to `producing` with a due date and builds the brief card and the reminder text. */
export class Assign extends NodeRun(AssignCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ folder: s.folder, shots: s.shots })
    override readonly into = ["assigned"] as const
    override readonly next = PostBrief
}
