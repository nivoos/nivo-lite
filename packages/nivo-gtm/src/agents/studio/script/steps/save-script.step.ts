import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioSaveScript as SaveScriptCell } from "../save-script.cell.ts"
import { AskReview } from "./ask-review.step.ts"
import type { State } from "../script.workflow.ts"

/** Saves the draft on the content item (status `script_review`) and builds the review card and its deadlines. */
export class SaveScript extends NodeRun(SaveScriptCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ objectId: s.change.objectId, draft: s.draft })
    override readonly into = ["saved"] as const
    override readonly next = AskReview
}
