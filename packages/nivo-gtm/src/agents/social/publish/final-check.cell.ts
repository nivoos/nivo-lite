import { z } from "zod"
import type { ModelGenerate, Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import type { BrainSearch } from "../common/callees.ts"
import { clip } from "../common/helpers.ts"
import { SOCIAL_POLICY } from "../common/social.policy.ts"
import { OpenOutput } from "./open.cell.ts"

export const FinalCheckOutput = z.strictObject({ ok: z.boolean(), reason: z.string().max(400) })

type In = z.infer<typeof OpenOutput>
type Out = z.infer<typeof FinalCheckOutput>

const GOAL =
    "Last check before a post goes out. `text` is the post. Decide `ok`: true only when nothing in it is outdated or untrue against `brain`, and every price word, number of plans, credit or discount in it appears in the public price document in `brain`. " +
    "A post with no price words is fine. When not ok, say in `reason` (Vietnamese, one sentence) what must change."

/**
 * `nivo-gtm.social-final-check` (Kiểm tra lần cuối): ONE generation, only for a publication that is still `scheduled` (a person who cancelled or moved it first is not asked again: the node answers `ok` false without calling the
 * model). The model compares the post with the public price table and the facts of the brain.
 */
export class SocialFinalCheck implements Node<typeof OpenOutput, typeof FinalCheckOutput> {
    readonly key = keyOf("social-final-check")
    readonly version = 1
    readonly title = { vi: "Kiểm tra bài trước khi đăng", en: "Check the post before it goes out" }
    readonly input = OpenOutput
    readonly output = FinalCheckOutput
    readonly reads = ["brain.search"]
    readonly mutation = "model.generate"
    readonly model = { model: "sonnet-5-5", effort: "fast" } as const

    run(input: In, reach: NodeReach): Out {
        if (input.status !== "scheduled")
            return reach.reply<Out>({
                ok: false,
                reason: `Lượt đăng không còn ở trạng thái đã lên lịch (${input.status}).`,
            }).result.value
        const { result: found } = reach.call<BrainSearch>("brain.search", {
            query: "plans, prices, credit and features of NIVO",
            limit: 6,
        })
        const brain = found.hits.map((hit) => clip(JSON.stringify(hit.passage ?? hit.truth), 1200))
        const { result, error } = reach.call<ModelGenerate<Out>>("model.generate", {
            prompt: `${SOCIAL_POLICY}\n\n${GOAL}`,
            data: { text: input.text, channel: input.channel, brain },
        })
        if (error) throw error
        return result.value
    }
}
