import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioDraft as DraftCell } from "../draft.cell.ts"
import { SaveScript } from "./save-script.step.ts"
import type { State } from "../script.workflow.ts"

/** Writes the first draft of the script (hook, beats, b-roll, call to action, caption) from the brief. */
export class Draft extends NodeRun(DraftCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        objectId: s.brief.objectId,
        code: s.brief.code,
        title: s.brief.title,
        pillar: s.brief.pillar,
        hook: s.brief.hook,
        brain: s.brief.brain,
        past: s.brief.past,
    })
    override readonly into = ["draft"] as const
    override readonly next = SaveScript
}
