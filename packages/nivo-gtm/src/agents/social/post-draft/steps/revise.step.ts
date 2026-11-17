import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialRevise as ReviseCell } from "../revise.cell.ts"
import { IsRevised } from "./is-revised.step.ts"
import type { State } from "../post-draft.workflow.ts"

export class Revise extends NodeRun(ReviseCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ previous: s.draft })
    override readonly into = ["draft"] as const
    override readonly next = IsRevised
}
