import { z } from "zod"
import type { Node, NodeReach, NivoRef } from "@starci/nivoos-sdk"
import { Lead } from "../../../objects/lead.object.ts"
import { keyOf } from "../../../package-key.ts"

export const CountFollowUpInput = z.strictObject({ leadId: z.string().min(1).max(80), nextDueMs: z.number().int().nonnegative() })
export const CountFollowUpOutput = z.strictObject({ leadId: z.string(), followUps: z.number().int().nonnegative() })

type In = z.infer<typeof CountFollowUpInput>
type Out = z.infer<typeof CountFollowUpOutput>

/**
 * Counts the follow-up that went out: one act, `object.update` of `gtm.lead` (follow-ups + 1, last contact now, the next action "wait for the lead" due when the next follow-up does, or in a week
 * when none is left).
 */
export class CountFollowUp implements Node<typeof CountFollowUpInput, typeof CountFollowUpOutput> {
    readonly key = keyOf("leads-count-follow-up")
    readonly version = 3
    readonly title = { vi: "Ghi nhận đã nhắn lại", en: "Count the follow-up" }
    readonly input = CountFollowUpInput
    readonly output = CountFollowUpOutput
    readonly reads = ["object.get"]
    readonly mutation = "object.update"

    run(input: In, reach: NodeReach): Out {
        const got = reach.objects(Lead).get(input.leadId as NivoRef<Lead>)
        if (got.error) throw got.error
        const lead = got.result
        const count = (lead.values.followUps ?? 0) + 1
        const now = reach.facts.at
        const dueMs = input.nextDueMs > 0 ? input.nextDueMs : Date.parse(now) + 7 * 86_400_000
        const { result, error } = reach.objects(Lead).update({
            id: lead.id,
            version: lead.version,
            values: { followUps: count, lastContactAt: now, nextAction: `Chờ khách phản hồi (đã nhắn lại ${count} lần)`, nextAt: new Date(dueMs).toISOString() },
        })
        if (error) throw error
        return { leadId: result.id, followUps: count }
    }
}
