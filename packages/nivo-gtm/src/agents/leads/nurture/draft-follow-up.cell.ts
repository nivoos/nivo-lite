import { z } from "zod"
import type { ModelGenerate, Node, NodeReach } from "@starci/nivoos-sdk"
import { Lead } from "../../../objects/lead.object.ts"
import { keyOf } from "../../../package-key.ts"
import { publicHitsOf, type BrainSearch } from "../common/brain-search.ts"
import { LEADS_POLICY } from "../common/leads.guidance.ts"
import { assertRef } from "../common/typed-ref.ts"

export const DraftFollowUpInput = z.strictObject({ leadId: z.string().min(1).max(80) })
export const DraftFollowUpOutput = z.strictObject({ text: z.string().min(1).max(1200) })
/** How many brain hits the draft reads. A workspace may change it in the console. */
export const DraftFollowUpSettings = z.strictObject({ brainHits: z.number().int().min(1).max(20).default(6) })

type In = z.infer<typeof DraftFollowUpInput>
type Out = z.infer<typeof DraftFollowUpOutput>
type Settings = z.infer<typeof DraftFollowUpSettings>

const GOAL =
    "A lead went quiet and the team follows up. `lead` is what is known (`fitNotes` are dated lines of what they said, oldest first; `followUps` is how many follow-ups were already sent). " +
    "Write the next follow-up as `text`: a person approves it, then it is sent. Pick up what THEY said last, add one useful thing from `brain` (a feature, a way NIVO would help their kind of " +
    "business) and end with ONE easy question or the offer of a demo. Do not repeat an earlier message, do not pressure, and never state a price, a discount or a trial that `brain` does not " +
    "give. The more follow-ups already went out, the shorter and lighter this one is. Two to four sentences."

/**
 * `nivo-gtm.leads-draft-follow-up` (Soạn tin nhắn lại): ONE generation writes the follow-up from the lead's notes and the PUBLIC part of the brain (this run is on a lead, so the cell narrows the
 * engine's team lens to public itself). It sends nothing; the send is the next step, and it asks.
 */
export class DraftFollowUp implements Node<
    typeof DraftFollowUpInput,
    typeof DraftFollowUpOutput,
    typeof DraftFollowUpSettings
> {
    readonly key = keyOf("leads-draft-follow-up")
    readonly version = 3
    readonly title = { vi: "Soạn tin nhắn lại cho khách", en: "Write the follow-up" }
    readonly input = DraftFollowUpInput
    readonly output = DraftFollowUpOutput
    readonly settings = DraftFollowUpSettings
    readonly reads = ["object.get", "brain.search"]
    readonly mutation = "model.generate"
    readonly model = { model: "sonnet-5-5", effort: "fast" } as const

    run(input: In, reach: NodeReach<Settings>): Out {
        assertRef<Lead>(input.leadId)
        const got = reach.objects(Lead).get(input.leadId)
        if (got.error) throw got.error
        const lead = got.result.values
        const hits = reach.call<BrainSearch>("brain.search", {
            query: `NIVO ${lead.segment ?? ""} ${lead.business ?? ""} ${(lead.fitNotes ?? "").slice(-300)}`.trim(),
            limit: reach.settings.brainHits,
        }).result.hits
        const { result, error } = reach.call<ModelGenerate<Out>>("model.generate", {
            prompt: `${LEADS_POLICY}\n\n${GOAL}`,
            data: {
                lead: {
                    name: lead.name ?? "",
                    business: lead.business ?? "",
                    segment: lead.segment ?? "",
                    followUps: lead.followUps ?? 0,
                    fitNotes: lead.fitNotes ?? "",
                },
                brain: publicHitsOf(hits),
            },
        })
        if (error) throw error
        return result.value
    }
}
