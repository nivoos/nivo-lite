import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioReadBrief as ReadBriefCell } from "../read-brief.cell.ts"
import { Draft } from "./draft.step.ts"
import type { State } from "../script.workflow.ts"

export class ReadBrief extends NodeRun(ReadBriefCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ objectId: s.change.objectId })
    override readonly into = ["brief"] as const
    override readonly next = Draft
}
