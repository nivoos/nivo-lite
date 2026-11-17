import { z } from "zod"
import type { ModelGenerate, Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { SOCIAL_POLICY } from "../common/social.policy.ts"
import { PostDraft } from "../common/social.shapes.ts"
import { ReadOutput } from "./read.cell.ts"

export const DraftInput = ReadOutput
export const DraftOutput = PostDraft
/** The length of a post a channel takes, as a per-customer rule. */
export const DraftSettings = z.strictObject({ maxChars: z.number().int().min(100).max(2500).default(900) })

type In = z.infer<typeof DraftInput>
type Out = z.infer<typeof DraftOutput>
type Settings = z.infer<typeof DraftSettings>

const GOAL =
    "Write ONE post for the NIVO channel from the idea (`title`, `pillar`, `hook`): a caption that opens with the hook, at most `maxChars` characters, 3 to 6 hashtags (with the #), and the short text that goes on the post image (`imageText`). " +
    "Set `ok` true and `revision` 0. Say nothing a person has not approved: no price, no discount, no promise that `brain` does not state. The image itself is made by a person (a Canva step is a later item)."

/**
 * `nivo-gtm.social-draft` (Soạn bài đăng): ONE generation. The caption, the hashtags and the image text of a post, from the chosen idea and the brain. A person reviews it before anything leaves the company.
 */
export class SocialDraft implements Node<typeof DraftInput, typeof DraftOutput, typeof DraftSettings> {
    readonly key = keyOf("social-draft")
    readonly version = 1
    readonly title = { vi: "Soạn bài đăng", en: "Draft the post" }
    readonly input = DraftInput
    readonly output = DraftOutput
    readonly settings = DraftSettings
    readonly reads = []
    readonly mutation = "model.generate"
    readonly model = { model: "sonnet-5-5", effort: "balanced" } as const

    run(input: In, reach: NodeReach<Settings>): Out {
        const { result, error } = reach.call<ModelGenerate<Out>>("model.generate", {
            prompt: `${SOCIAL_POLICY}\n\n${GOAL}`,
            data: { title: input.title, pillar: input.pillar, hook: input.hook, maxChars: reach.settings.maxChars, brain: input.brain },
        })
        if (error) throw error
        return { ...result.value, ok: true, revision: 0, caption: result.value.caption.slice(0, reach.settings.maxChars) }
    }
}
