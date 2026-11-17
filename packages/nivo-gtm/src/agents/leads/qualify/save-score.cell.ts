import { z } from "zod"
import type { Node, NodeReach, NivoRef } from "@starci/nivoos-sdk"
import { Lead } from "../../../objects/lead.object.ts"
import { keyOf } from "../../../package-key.ts"

export const SaveScoreInput = z.strictObject({ leadId: z.string().min(1).max(80), score: z.number().int().min(0).max(100), segment: z.string().max(80), reasons: z.string().min(1).max(600) })
export const SaveScoreOutput = z.strictObject({ leadId: z.string(), code: z.string(), stage: z.string(), score: z.number().int(), qualified: z.boolean() })
/** The business rules: the score from which a lead is qualified, and the score under which a lead that has barely started is dropped as unfit. */
export const SaveScoreSettings = z.strictObject({ qualifyAt: z.number().int().min(1).max(100).default(60), dropBelow: z.number().int().min(0).max(99).default(25) })

type In = z.infer<typeof SaveScoreInput>
type Out = z.infer<typeof SaveScoreOutput>
type Settings = z.infer<typeof SaveScoreSettings>

/**
 * Writes the score on the lead: one act, `object.update` of `gtm.lead`. A lead that is new, engaged, cold or already qualified and scores `qualifyAt` or more becomes `qualified` with the next action
 * "invite to a demo"; a new or engaged lead under `dropBelow` becomes `unfit`; anything else keeps its stage (a lead with a demo booked or won is never moved back). The reasons go to `evidence`.
 */
export class SaveScore implements Node<typeof SaveScoreInput, typeof SaveScoreOutput, typeof SaveScoreSettings> {
    readonly key = keyOf("leads-save-score")
    readonly version = 3
    readonly title = { vi: "Lưu điểm khách", en: "Save the score" }
    readonly input = SaveScoreInput
    readonly output = SaveScoreOutput
    readonly settings = SaveScoreSettings
    readonly reads = ["object.get"]
    readonly mutation = "object.update"

    run(input: In, reach: NodeReach<Settings>): Out {
        const got = reach.objects(Lead).get(input.leadId as NivoRef<Lead>)
        if (got.error) throw got.error
        const lead = got.result
        const current = lead.values.stage
        const movable = current === "new" || current === "engaged" || current === "cold" || current === "qualified"
        const starting = current === "new" || current === "engaged"
        const qualify = movable && input.score >= reach.settings.qualifyAt
        const drop = starting && input.score < reach.settings.dropBelow
        const stage = qualify ? "qualified" : drop ? "unfit" : current
        const { result, error } = reach.objects(Lead).update({
            id: lead.id,
            version: lead.version,
            values: {
                score: input.score,
                stage,
                evidence: `Điểm ${input.score}/100: ${input.reasons}`.slice(0, 2000),
                ...(input.segment === "" ? {} : { segment: input.segment }),
                ...(qualify && current !== "qualified" ? { nextAction: "Mời khách chọn giờ demo", nextAt: reach.facts.at } : {}),
            },
        })
        if (error) throw error
        return { leadId: result.id, code: result.values.code, stage: result.values.stage, score: input.score, qualified: qualify }
    }
}
