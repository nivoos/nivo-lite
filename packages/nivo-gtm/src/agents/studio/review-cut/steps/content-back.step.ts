import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioSetContentStatus as SetContentStatusCell } from "../set-content-status.cell.ts"
import { SentBack } from "./sent-back.step.ts"
import type { State } from "../review-cut.workflow.ts"

/** Moves the content item back to `producing` with the check summary as what the editor must fix. */
export class ContentBack extends NodeRun(SetContentStatusCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        objectId: s.cut.contentId,
        status: "producing" as const,
        nextAction: s.check.summary,
        evidence: "",
    })
    override readonly into = ["contentMarked"] as const
    override readonly next = SentBack
}
