import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import { SaveScript } from "./save-script.step.ts"
import { RevisionLimit } from "./revision-limit.step.ts"
import type { State } from "../script.workflow.ts"

/** Branches on whether the revision was made: a refused one (the cap `maxRevisions` is reached) ends the run. */
export class IsRevised extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.draft.ok === true
    override readonly label = { vi: "Còn được viết lại?", en: "Can be rewritten?" }
    override readonly yes = SaveScript
    override readonly no = RevisionLimit
}
