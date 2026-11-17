import { z } from "zod"
import type { Node, NodeReach, NivoRef } from "@starci/nivoos-sdk"
import { Lead, LEAD_STAGES } from "../../../objects/lead.object.ts"
import { keyOf } from "../../../package-key.ts"

export const SetStageInput = z.strictObject({
    leadId: z.string().min(1).max(80),
    stage: z.enum(LEAD_STAGES),
    nextAction: z.string().min(1).max(300),
    /** The instant the next action falls due (ms since the epoch); 0 means `nextAfterHours` from now. */
    nextAtMs: z.number().int().nonnegative(),
    nextAfterHours: z.number().int().nonnegative().max(8760),
})
export const SetStageOutput = z.strictObject({ leadId: z.string(), version: z.number().int(), stage: z.string() })

type In = z.infer<typeof SetStageInput>
type Out = z.infer<typeof SetStageOutput>

/** Moves a lead to a stage with its next action and due time: one act, `object.update` of `gtm.lead`. Used by every workflow that changes where a lead stands (cold, demo booked, demo done). */
export class SetStage implements Node<typeof SetStageInput, typeof SetStageOutput> {
    readonly key = keyOf("leads-set-stage")
    readonly version = 1
    readonly title = { vi: "Chuyển giai đoạn khách", en: "Move the lead to a stage" }
    readonly input = SetStageInput
    readonly output = SetStageOutput
    readonly reads = ["object.get"]
    readonly mutation = "object.update"

    run(input: In, reach: NodeReach): Out {
        const got = reach.objects(Lead).get(input.leadId as NivoRef<Lead>)
        if (got.error) throw got.error
        const lead = got.result
        const dueMs = input.nextAtMs > 0 ? input.nextAtMs : Date.parse(reach.facts.at) + input.nextAfterHours * 3_600_000
        const { result, error } = reach.objects(Lead).update({
            id: lead.id,
            version: lead.version,
            values: { stage: input.stage, nextAction: input.nextAction, nextAt: new Date(dueMs).toISOString() },
        })
        if (error) throw error
        return { leadId: result.id, version: result.version, stage: result.values.stage }
    }
}
