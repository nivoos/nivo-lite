import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioMarkCut as MarkCutCell } from "../mark-cut.cell.ts"
import { ContentApproved } from "./content-approved.step.ts"
import type { State } from "../review-cut.workflow.ts"

/** Marks the cut `approved` by the member who answered, with the check summary as the note. */
export class MarkCutApproved extends NodeRun(MarkCutCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        cutId: s.cut.cutId,
        verdict: "approved" as const,
        memberId: s.answers.at(-1).memberId,
        note: s.check.summary,
    })
    override readonly into = ["cutMarked"] as const
    override readonly next = ContentApproved
}
