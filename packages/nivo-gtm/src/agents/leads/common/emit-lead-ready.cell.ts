import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import type { LeadReady } from "../../../common/events/lead-ready.event.ts"
import { keyOf } from "../../../package-key.ts"

export const EmitLeadReadyInput = z.strictObject({ leadId: z.string().min(1).max(80), code: z.string().min(1).max(60), reason: z.string().min(1).max(500), turns: z.number().int().nonnegative() })
export const EmitLeadReadyOutput = z.strictObject({ emitted: z.literal(true) })

type In = z.infer<typeof EmitLeadReadyInput>
type Out = z.infer<typeof EmitLeadReadyOutput>

/** Says the lead is ready to be scored: one act, `events.emit` of `LeadReady` on the subject `lead:<code>`. The key is the lead and its turn count, so one more turn is one more event and a rerun is none. */
export class EmitLeadReady implements Node<typeof EmitLeadReadyInput, typeof EmitLeadReadyOutput> {
    readonly key = keyOf("leads-emit-lead-ready")
    readonly version = 1
    readonly title = { vi: "Báo khách sẵn sàng", en: "Say the lead is ready" }
    readonly input = EmitLeadReadyInput
    readonly output = EmitLeadReadyOutput
    readonly reads = []
    readonly mutation = "events.emit"

    run(input: In, reach: NodeReach): Out {
        const { error } = reach.emit<typeof LeadReady>("nivo-gtm.lead.ready", {
            subject: { kind: "lead", id: input.code },
            data: { leadId: input.leadId, reason: input.reason },
            key: `${input.leadId}:ready:${input.turns}`,
        })
        if (error) throw error
        return { emitted: true }
    }
}
