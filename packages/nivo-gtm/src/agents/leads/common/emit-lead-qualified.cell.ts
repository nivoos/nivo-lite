import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import type { LeadQualified } from "../../../common/events/lead-qualified.event.ts"
import { keyOf } from "../../../package-key.ts"

export const EmitLeadQualifiedInput = z.strictObject({ leadId: z.string().min(1).max(80), code: z.string().min(1).max(60), score: z.number().int().min(0).max(100) })
export const EmitLeadQualifiedOutput = z.strictObject({ emitted: z.literal(true) })

type In = z.infer<typeof EmitLeadQualifiedInput>
type Out = z.infer<typeof EmitLeadQualifiedOutput>

/** Says the lead scored above the line: one act, `events.emit` of `LeadQualified` on the subject `lead:<code>`. The key is the lead and the day, so a lead qualifies at most once a day. */
export class EmitLeadQualified implements Node<typeof EmitLeadQualifiedInput, typeof EmitLeadQualifiedOutput> {
    readonly key = keyOf("leads-emit-lead-qualified")
    readonly version = 1
    readonly title = { vi: "Báo khách đạt chuẩn", en: "Say the lead is qualified" }
    readonly input = EmitLeadQualifiedInput
    readonly output = EmitLeadQualifiedOutput
    readonly reads = []
    readonly mutation = "events.emit"

    run(input: In, reach: NodeReach): Out {
        const { error } = reach.emit<typeof LeadQualified>("nivo-gtm.lead.qualified", {
            subject: { kind: "lead", id: input.code },
            data: { leadId: input.leadId, score: input.score },
            key: `${input.leadId}:qualified:${reach.facts.day}`,
        })
        if (error) throw error
        return { emitted: true }
    }
}
