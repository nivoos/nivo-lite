import { z } from "zod"
import type { ModelGenerate, Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { STUDIO_POLICY } from "../common/studio.policy.ts"
import { ScriptDraft } from "../common/studio.shapes.ts"
import { ReadBriefOutput } from "./read-brief.cell.ts"

export const ReviseInput = z.strictObject({ brief: ReadBriefOutput, previous: ScriptDraft })
export const ReviseOutput = ScriptDraft
/** How many times a person may ask for a rewrite before the run ends `revision_limit`, and the length of the video. */
export const ReviseSettings = z.strictObject({
    maxRevisions: z.number().int().min(0).max(10).default(3),
    videoSeconds: z.number().int().min(10).max(180).default(45),
})

type In = z.infer<typeof ReviseInput>
type Out = z.infer<typeof ReviseOutput>
type Settings = z.infer<typeof ReviseSettings>

const GOAL =
    "A person asked for another version of this script (the card carries no note). Write a tighter, more concrete version: a stronger hook in the first 3 seconds, fewer words per beat, one clear call to action, " +
    "the same facts. Keep the same members as `previous` and set `ok` true; `revision` is the number given in `revision`."

/**
 * `nivo-gtm.studio-revise` (Viết lại kịch bản): ONE generation of the next version when the person pressed Sửa. At `maxRevisions` it asks the model nothing and answers `ok: false`, so the workflow ends `revision_limit`.
 * (The review card carries no free-text note yet: the rewrite is a generic tightening, see the gaps.)
 */
export class StudioRevise implements Node<typeof ReviseInput, typeof ReviseOutput, typeof ReviseSettings> {
    readonly key = keyOf("studio-revise")
    readonly version = 2
    readonly title = { vi: "Viết lại kịch bản", en: "Rewrite the script" }
    readonly input = ReviseInput
    readonly output = ReviseOutput
    readonly settings = ReviseSettings
    readonly reads = []
    readonly mutation = "model.generate"
    readonly model = { model: "opus-5-5", effort: "balanced" } as const

    run(input: In, reach: NodeReach<Settings>): Out {
        const revision = input.previous.revision + 1
        if (revision > reach.settings.maxRevisions)
            return {
                ok: false,
                revision: input.previous.revision,
                hook: "",
                beats: [],
                broll: [],
                cta: "",
                caption: "",
                seconds: 0,
            }
        const { result, error } = reach.call<ModelGenerate<Out>>("model.generate", {
            prompt: `${STUDIO_POLICY}\n\n${GOAL}`,
            data: {
                title: input.brief.title,
                pillar: input.brief.pillar,
                brain: input.brief.brain,
                videoSeconds: reach.settings.videoSeconds,
                revision,
                previous: input.previous,
            },
        })
        if (error) throw error
        return { ...result.value, ok: true, revision }
    }
}
