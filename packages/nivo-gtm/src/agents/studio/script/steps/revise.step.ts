import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioRevise as ReviseCell } from "../revise.cell.ts"
import { IsRevised } from "./is-revised.step.ts"
import type { State } from "../script.workflow.ts"

/** Writes the next version of the script from the brief and the previous draft, up to `maxRevisions` times. */
export class Revise extends NodeRun(ReviseCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ brief: s.brief, previous: s.draft })
    override readonly into = ["draft"] as const
    override readonly next = IsRevised
}
