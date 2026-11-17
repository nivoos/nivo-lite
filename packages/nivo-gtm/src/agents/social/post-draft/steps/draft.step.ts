import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialDraft as DraftCell } from "../draft.cell.ts"
import { Save } from "./save.step.ts"
import type { State } from "../post-draft.workflow.ts"

export class Draft extends NodeRun(DraftCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ objectId: s.brief.objectId, code: s.brief.code, title: s.brief.title, pillar: s.brief.pillar, hook: s.brief.hook, brain: s.brief.brain })
    override readonly into = ["draft"] as const
    override readonly next = Save
}
