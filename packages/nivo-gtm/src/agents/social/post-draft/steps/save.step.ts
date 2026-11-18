import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialSaveDraft as SaveCell } from "../save.cell.ts"
import { AskReview } from "./ask-review.step.ts"
import type { State } from "../post-draft.workflow.ts"

/** Saves the draft on the content object and builds the review card. */
export class Save extends NodeRun(SaveCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ objectId: s.change.objectId, draft: s.draft })
    override readonly into = ["saved"] as const
    override readonly next = AskReview
}
