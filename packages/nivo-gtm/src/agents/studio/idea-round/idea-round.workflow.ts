import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { ReadContextOutput } from "./read-context.cell.ts"
import { IdeasOutput } from "./ideas.cell.ts"
import { FileIdeasOutput } from "./file-ideas.cell.ts"
import { AskTeamOutput } from "../common/ask-team.cell.ts"
import { keyOf } from "../../../package-key.ts"
import { Tick } from "./steps/tick.step.ts"
import { ReadContext } from "./steps/read-context.step.ts"
import { Ideas } from "./steps/ideas.step.ts"
import { FileIdeas } from "./steps/file-ideas.step.ts"
import { PostIdeas } from "./steps/post-ideas.step.ts"
import { Done } from "./steps/done.step.ts"

/** The one state object of a run. */
export const State = z.strictObject({
    tick: z.strictObject({ instant: z.string().min(10).max(40) }).optional(),
    context: ReadContextOutput.optional(),
    ideas: IdeasOutput.optional(),
    filed: FileIdeasOutput.optional(),
    posted: AskTeamOutput.optional(),
})

/**
 * `nivo-gtm.studio-idea-round` (Vòng ý tưởng tuần): the clock opens a run at 08:00 every Monday (Ho Chi Minh City). The week's context is read, ONE generation thinks up the ideas, each is filed as a `gtm.content`
 * (status `idea`) and ONE card in the team room lists them with Chọn per idea and Bỏ cả tuần. The answer is taken by the `pick` workflow. Nothing leaves the company, so every step runs `auto`.
 */
export class IdeaRound implements Workflow<typeof State> {
    readonly key = keyOf("studio-idea-round")
    readonly version = 2
    readonly title = { vi: "Vòng ý tưởng tuần", en: "Weekly idea round" }
    readonly state = State
    readonly start = Tick
    readonly steps = [Tick, ReadContext, Ideas, FileIdeas, PostIdeas, Done]
}
