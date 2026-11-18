import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioCheckCut as CheckCutCell } from "../check-cut.cell.ts"
import { ReviewCard } from "./review-card.step.ts"
import type { State } from "../review-cut.workflow.ts"

/** Checks the cut against the approved script and the public price document. */
export class CheckCut extends NodeRun(CheckCutCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        contentId: s.ctx.contentId,
        cutId: s.ctx.cutId,
        version: s.ctx.version,
        code: s.ctx.code,
        title: s.ctx.title,
        fileLink: s.ctx.fileLink,
        hook: s.ctx.hook,
        cta: s.ctx.cta,
        seconds: s.ctx.seconds,
        caption: s.ctx.caption,
        brain: s.ctx.brain,
    })
    override readonly into = ["check"] as const
    override readonly next = ReviewCard
}
