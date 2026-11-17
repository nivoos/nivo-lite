import { z } from "zod"
import type { ModelGenerate, Node, NodeReach, NivoRef } from "@starci/nivoos-sdk"
import { Lead } from "../../../objects/lead.object.ts"
import { keyOf } from "../../../package-key.ts"
import type { BrainSearch } from "../common/brain-search.ts"

export const ScoreInput = z.strictObject({ leadId: z.string().min(1).max(80) })
export const ScoreOutput = z.strictObject({ score: z.number().int().min(0).max(100), segment: z.string().max(80), reasons: z.string().min(1).max(600) })
/** How many brain hits the scoring reads (the ideal-customer rubric). A workspace may change it in the console. */
export const ScoreSettings = z.strictObject({ brainHits: z.number().int().min(1).max(20).default(6) })

type In = z.infer<typeof ScoreInput>
type Out = z.infer<typeof ScoreOutput>
type Settings = z.infer<typeof ScoreSettings>

const GOAL =
    "You score a sales lead for NIVO from 0 to 100: how well they fit NIVO's ideal customer. `lead` is what the team knows (`fitNotes` are dated lines of what they said and did, oldest first); " +
    "`brain` holds NIVO's ideal-customer rubric and sales process (internal: it is for you, never for the customer). Weigh: kind of business and size, the channels they use, a real pain NIVO " +
    "solves, a budget signal and timing. A lead that asked for a demo or a price with a clear business scores higher; one with no business named stays below 50; one that is out of scope or " +
    "spam scores under 20. Set `segment` to a short label of their kind of business (empty when unknown). Write `reasons` in Vietnamese, one or two sentences the sales lead can read at a glance."

/**
 * `nivo-gtm.leads-score` (Chấm điểm khách): reads the lead and the internal rubric and ONE generation answers the score, the segment and the reasons. This run is internal (on a lead, with the team's
 * lens): its output goes to the lead object, never to the customer. A model that cannot answer stops the run here for a person.
 */
export class Score implements Node<typeof ScoreInput, typeof ScoreOutput, typeof ScoreSettings> {
    readonly key = keyOf("leads-score")
    readonly version = 1
    readonly title = { vi: "Chấm điểm khách", en: "Score the lead" }
    readonly input = ScoreInput
    readonly output = ScoreOutput
    readonly settings = ScoreSettings
    readonly reads = ["object.get", "brain.search"]
    readonly mutation = "model.generate"
    readonly model = { model: "sonnet-5-5", effort: "balanced" } as const

    run(input: In, reach: NodeReach<Settings>): Out {
        const got = reach.objects(Lead).get(input.leadId as NivoRef<Lead>)
        if (got.error) throw got.error
        const lead = got.result.values
        const hits = reach.call<BrainSearch>("brain.search", { query: `khách lý tưởng tiêu chí chấm điểm ${lead.segment ?? ""} ${lead.business ?? ""}`.trim(), limit: reach.settings.brainHits }).result.hits
        const { result, error } = reach.call<ModelGenerate<Out>>("model.generate", {
            prompt: GOAL,
            data: {
                lead: {
                    name: lead.name ?? "",
                    business: lead.business ?? "",
                    segment: lead.segment ?? "",
                    source: lead.source ?? "",
                    stage: lead.stage,
                    followUps: lead.followUps ?? 0,
                    fitNotes: lead.fitNotes ?? "",
                },
                brain: hits.map((hit) => ({ kind: hit.kind, truth: hit.truth, passage: hit.passage })),
            },
        })
        if (error) throw error
        return result.value
    }
}
