import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialMirror as MirrorCell } from "../mirror.cell.ts"
import { PostWeek } from "./post-week.step.ts"
import type { State } from "../calendar-round.workflow.ts"

/** Mirrors the filed week into the calendar sheet when one is set. */
export class Mirror extends NodeRun(MirrorCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ weekCode: s.filed.weekCode, filed: s.filed.filed })
    override readonly into = ["mirror"] as const
    override readonly next = PostWeek
}
