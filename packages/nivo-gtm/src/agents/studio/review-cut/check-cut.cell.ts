import { z } from "zod"
import type { ModelGenerate, Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { STUDIO_POLICY } from "../common/studio.policy.ts"
import { ReadCutOutput } from "./read-cut.cell.ts"
export { ReadCutOutput as CheckCutInput } from "./read-cut.cell.ts"

export const CheckCutOutput = z.strictObject({
    summary: z.string().min(1).max(400),
    items: z
        .array(
            z.strictObject({
                check: z.string().min(1).max(160),
                status: z.enum(["ok", "fail", "unknown"]),
                note: z.string().max(300),
            }),
        )
        .min(1)
        .max(10),
})
/** The length a video should have: the same per-customer rule the script used. */
export const CheckCutSettings = z.strictObject({ videoSeconds: z.number().int().min(10).max(180).default(45) })

type In = z.infer<typeof ReadCutOutput>
type Out = z.infer<typeof CheckCutOutput>
type Settings = z.infer<typeof CheckCutSettings>

const GOAL =
    "Write the checklist a person uses to review a finished video cut against its approved script. You see the script (`hook`, `cta`, `seconds`, `caption`) and the link of the cut, NOT the video itself: mark an item `ok` only when the " +
    "script and the caption settle it, `fail` when they break a rule, and `unknown` when only watching the cut can tell (say so in `note`). Check: the call to action is the script's; the caption states a price only if it matches " +
    "the public price document in `brain`; the planned length is close to `videoSeconds`; subtitles are present (always `unknown`: ask the reviewer); the opening matches the hook. `summary` is one sentence for the card."

/**
 * `nivo-gtm.studio-check-cut` (Kiểm tra bản dựng): ONE generation of the review checklist for the cut against its approved script and the public price document. It cannot see the video: what only watching settles is `unknown`
 * and left to the person (a vendor transcript, when there is one, would let it check more).
 */
export class StudioCheckCut implements Node<typeof ReadCutOutput, typeof CheckCutOutput, typeof CheckCutSettings> {
    readonly key = keyOf("studio-check-cut")
    readonly version = 1
    readonly title = { vi: "Kiểm tra bản dựng", en: "Check the cut" }
    readonly input = ReadCutOutput
    readonly output = CheckCutOutput
    readonly settings = CheckCutSettings
    readonly reads = []
    readonly mutation = "model.generate"
    readonly model = { model: "sonnet-5-5", effort: "balanced" } as const

    run(input: In, reach: NodeReach<Settings>): Out {
        const { result, error } = reach.call<ModelGenerate<Out>>("model.generate", {
            prompt: `${STUDIO_POLICY}\n\n${GOAL}`,
            data: {
                code: input.code,
                title: input.title,
                link: input.fileLink,
                hook: input.hook,
                cta: input.cta,
                seconds: input.seconds,
                caption: input.caption,
                videoSeconds: reach.settings.videoSeconds,
                brain: input.brain,
            },
        })
        if (error) throw error
        return result.value
    }
}
