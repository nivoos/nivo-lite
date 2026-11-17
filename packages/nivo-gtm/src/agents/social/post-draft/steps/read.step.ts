import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialDraftRead as ReadCell } from "../read.cell.ts"
import { Draft } from "./draft.step.ts"
import type { State } from "../post-draft.workflow.ts"

export class Read extends NodeRun(ReadCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ objectId: s.change.objectId })
    override readonly into = ["brief"] as const
    override readonly next = Draft
}
