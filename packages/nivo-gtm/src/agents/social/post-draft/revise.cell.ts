import { z } from "zod"
import type { ModelGenerate, Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { SOCIAL_POLICY } from "../common/social.policy.ts"
import { PostDraft } from "../common/social.shapes.ts"

export const ReviseInput = z.strictObject({ previous: PostDraft })
export const ReviseOutput = PostDraft
/** How many times a post is rewritten before the run ends `max_revisions`, and its length. */
export const ReviseSettings = z.strictObject({
    maxRevisions: z.number().int().min(0).max(10).default(3),
    maxChars: z.number().int().min(100).max(2500).default(900),
})

type In = z.infer<typeof ReviseInput>
type Out = z.infer<typeof ReviseOutput>
type Settings = z.infer<typeof ReviseSettings>

const GOAL =
    "The reviewer asked for a different post and gave no note. Rewrite `previous`: a stronger first line, plainer words, a different angle on the same idea, at most `maxChars` characters. Keep the facts; add no price or promise. " +
    "Set `ok` true and `revision` to the previous revision plus one."

/**
 * `nivo-gtm.social-revise` (Viết lại bài đăng): ONE generation, up to `maxRevisions` times. At the cap the node answers `ok` false without asking the model (`reach.reply`), and the workflow ends the run `max_revisions`.
 */
export class SocialRevise implements Node<typeof ReviseInput, typeof ReviseOutput, typeof ReviseSettings> {
    readonly key = keyOf("social-revise")
    readonly version = 2
    readonly title = { vi: "Viết lại bài đăng", en: "Rewrite the post" }
    readonly input = ReviseInput
    readonly output = ReviseOutput
    readonly settings = ReviseSettings
    readonly reads = []
    readonly mutation = "model.generate"
    readonly model = { model: "sonnet-5-5", effort: "balanced" } as const

    run(input: In, reach: NodeReach<Settings>): Out {
        if (input.previous.revision >= reach.settings.maxRevisions)
            return reach.reply<Out>({
                ok: false,
                revision: input.previous.revision,
                caption: "",
                hashtags: [],
                imageText: "",
            }).result.value
        const { result, error } = reach.call<ModelGenerate<Out>>("model.generate", {
            prompt: `${SOCIAL_POLICY}\n\n${GOAL}`,
            data: { previous: input.previous, maxChars: reach.settings.maxChars },
        })
        if (error) throw error
        return {
            ...result.value,
            ok: true,
            revision: input.previous.revision + 1,
            caption: result.value.caption.slice(0, reach.settings.maxChars),
        }
    }
}
