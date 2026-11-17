import { z } from "zod"
import type { ModelGenerate, Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { publicHitsOf, type BrainSearch } from "../common/brain-search.ts"
import { LEADS_POLICY } from "../common/leads.guidance.ts"

export const OpenerInput = z.strictObject({ source: z.string().max(500), note: z.string().max(500) })
export const OpenerOutput = z.strictObject({ text: z.string().min(1).max(1200) })
/** How many brain hits the opener reads. A workspace may change it in the console. */
export const OpenerSettings = z.strictObject({ brainHits: z.number().int().min(1).max(20).default(6) })

type In = z.infer<typeof OpenerInput>
type Out = z.infer<typeof OpenerOutput>
type Settings = z.infer<typeof OpenerSettings>

const GOAL =
    "Someone showed interest in NIVO without writing to us first: `source` is where it happened (a post they commented on, an ad form, a sheet) and `note` is what they did. " +
    "Write the first message to them as `text`: a person from the team approves it, then it is sent. Say hello warmly, refer to what they did in one clause (never invent what they said), " +
    "tell them in one sentence what NIVO does using only `brain`, and ask ONE question: what their business is. No price, no discount, no promise. Two to four sentences."

/**
 * `nivo-gtm.leads-opener` (Tin chào đầu tiên): the first line to a lead that came from a signal (a comment, an ad form, a sheet row). It reads the brain, keeps only the PUBLIC hits (this run is on
 * a lead, not on a conversation, so the engine gives it the team's lens and the cell narrows it itself), and ONE generation writes the opener. The send is the next step, and it asks.
 */
export class Opener implements Node<typeof OpenerInput, typeof OpenerOutput, typeof OpenerSettings> {
    readonly key = keyOf("leads-opener")
    readonly version = 1
    readonly title = { vi: "Soạn tin chào đầu tiên", en: "Write the first message" }
    readonly input = OpenerInput
    readonly output = OpenerOutput
    readonly settings = OpenerSettings
    readonly reads = ["brain.search"]
    readonly mutation = "model.generate"
    readonly model = { model: "sonnet-5-5", effort: "fast" } as const

    run(input: In, reach: NodeReach<Settings>): Out {
        const hits = reach.call<BrainSearch>("brain.search", { query: `NIVO ${input.note} ${input.source}`.slice(0, 600), limit: reach.settings.brainHits }).result.hits
        const { result, error } = reach.call<ModelGenerate<Out>>("model.generate", {
            prompt: `${LEADS_POLICY}\n\n${GOAL}`,
            data: { source: input.source, note: input.note, brain: publicHitsOf(hits) },
        })
        if (error) throw error
        return result.value
    }
}
