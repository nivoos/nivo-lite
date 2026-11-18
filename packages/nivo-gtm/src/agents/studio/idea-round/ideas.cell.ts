import { z } from "zod"
import type { ModelGenerate, Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { STUDIO_POLICY } from "../common/studio.policy.ts"
import { Idea } from "../common/studio.shapes.ts"
import { ReadContextOutput } from "./read-context.cell.ts"
export { ReadContextOutput as IdeasInput } from "./read-context.cell.ts"

export const IdeasOutput = z.strictObject({ ideas: z.array(Idea).min(1).max(5) })
/** How many ideas a week and how long a video is: per-customer rules with the plan's defaults. */
export const IdeasSettings = z.strictObject({
    ideasPerWeek: z.number().int().min(1).max(5).default(5),
    videoSeconds: z.number().int().min(10).max(180).default(45),
})

type In = z.infer<typeof ReadContextOutput>
type Out = z.infer<typeof IdeasOutput>
type Settings = z.infer<typeof IdeasSettings>

const GOAL =
    "Propose `count` content ideas for next week: short videos of about `videoSeconds` seconds, and at most one text post. Each idea names its pillar (one of the internal pillars in `brain`), a hook that works in the first 3 seconds, " +
    "the angle, the format (`video` or `post`), the segment it speaks to (a small business owner type), and why now. Spread the pillars; never repeat a title in `open` or `recent`; learn from `metrics` (what got views, " +
    "engagement and leads) without inventing numbers. `brain` is what the company says about itself; ideas are written to be approved by a person before anything is made."

/**
 * `nivo-gtm.studio-ideas` (Nghĩ ý tưởng tuần): ONE generation, `ideasPerWeek` ideas from the week's context (the pillars, the voice, the last weeks' metrics, the ideas still open). Opus at a balanced effort:
 * idea work is where the quality of the week is decided.
 */
export class StudioIdeas implements Node<typeof ReadContextOutput, typeof IdeasOutput, typeof IdeasSettings> {
    readonly key = keyOf("studio-ideas")
    readonly version = 1
    readonly title = { vi: "Nghĩ ý tưởng tuần", en: "Think up the week's ideas" }
    readonly input = ReadContextOutput
    readonly output = IdeasOutput
    readonly settings = IdeasSettings
    readonly reads = []
    readonly mutation = "model.generate"
    readonly model = { model: "opus-5-5", effort: "balanced" } as const

    run(input: In, reach: NodeReach<Settings>): Out {
        const { result, error } = reach.call<ModelGenerate<Out>>("model.generate", {
            prompt: `${STUDIO_POLICY}\n\n${GOAL}`,
            data: {
                count: reach.settings.ideasPerWeek,
                videoSeconds: reach.settings.videoSeconds,
                brain: input.brain,
                metrics: input.metrics,
                recent: input.recent,
                open: input.open,
            },
        })
        if (error) throw error
        return { ideas: result.value.ideas.slice(0, reach.settings.ideasPerWeek) }
    }
}
