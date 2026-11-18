import { z } from "zod"
import type { ModelGenerate, Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { STUDIO_POLICY } from "../common/studio.policy.ts"
import { ScriptDraft } from "../common/studio.shapes.ts"
export { ScriptDraft as DraftOutput } from "../common/studio.shapes.ts"
import { ReadBriefOutput } from "./read-brief.cell.ts"
export { ReadBriefOutput as DraftInput } from "./read-brief.cell.ts"

/** The length of a video: a per-customer rule with the plan's default. */
export const DraftSettings = z.strictObject({ videoSeconds: z.number().int().min(10).max(180).default(45) })

type In = z.infer<typeof ReadBriefOutput>
type Out = z.infer<typeof ScriptDraft>
type Settings = z.infer<typeof DraftSettings>

const GOAL =
    "Write the script of one short vertical video about the chosen idea (`title`, `pillar`, `hook`). Give: `hook` (the first 3 seconds: one spoken line and what is on screen), `beats` (each with `at` such as 3-10s, `onScreen` text and " +
    "`voiceOver`), `broll` (what to film or screen-record), `cta` (one call to action, no price unless the public price document states it), `caption` (the post text under the video) and `seconds` " +
    "(the total, close to `videoSeconds`). Use the voice in `brain` and learn from `past` hooks without copying. Set `ok` true and `revision` 0."

/** `nivo-gtm.studio-draft` (Viết kịch bản): ONE generation of the script with its shot beats. Opus at a balanced effort: the script is what the shoot follows. */
export class StudioDraft implements Node<typeof ReadBriefOutput, typeof ScriptDraft, typeof DraftSettings> {
    readonly key = keyOf("studio-draft")
    readonly version = 1
    readonly title = { vi: "Viết kịch bản", en: "Draft the script" }
    readonly input = ReadBriefOutput
    readonly output = ScriptDraft
    readonly settings = DraftSettings
    readonly reads = []
    readonly mutation = "model.generate"
    readonly model = { model: "opus-5-5", effort: "balanced" } as const

    run(input: In, reach: NodeReach<Settings>): Out {
        const { result, error } = reach.call<ModelGenerate<Out>>("model.generate", {
            prompt: `${STUDIO_POLICY}\n\n${GOAL}`,
            data: {
                title: input.title,
                pillar: input.pillar,
                hook: input.hook,
                videoSeconds: reach.settings.videoSeconds,
                brain: input.brain,
                past: input.past,
            },
        })
        if (error) throw error
        return { ...result.value, ok: true, revision: 0 }
    }
}
