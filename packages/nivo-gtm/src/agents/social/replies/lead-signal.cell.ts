import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import type { LeadSignal } from "../../../common/events/lead-signal.event.ts"
import { keyOf } from "../../../package-key.ts"

export const LeadSignalInput = z.strictObject({ fromId: z.string().min(1).max(40), messageId: z.string().min(1).max(40), summary: z.string().max(300) })
export const LeadSignalOutput = z.strictObject({ emitted: z.literal(true), key: z.string() })

type In = z.infer<typeof LeadSignalInput>
type Out = z.infer<typeof LeadSignalOutput>

/**
 * `nivo-gtm.social-lead-signal` (Báo khách quan tâm): one act, `events.emit` of `nivo-gtm.lead.signal` on the subject `lead:tg-<fromId>`, keyed by the comment: the Leads agent opens a lead from it. Internal: nothing is said to the person here.
 */
export class SocialLeadSignal implements Node<typeof LeadSignalInput, typeof LeadSignalOutput> {
    readonly key = keyOf("social-lead-signal")
    readonly version = 1
    readonly title = { vi: "Báo khách quan tâm", en: "Signal an interested person" }
    readonly input = LeadSignalInput
    readonly output = LeadSignalOutput
    readonly reads = []
    readonly mutation = "events.emit"

    run(input: In, reach: NodeReach): Out {
        const key = `signal:${input.messageId}`
        const { error } = reach.emit<typeof LeadSignal>("nivo-gtm.lead.signal", {
            subject: { kind: "lead", id: `tg-${input.fromId}` },
            data: { source: "telegram-comment", contactRef: input.fromId, note: input.summary },
            key,
        })
        if (error) throw error
        return { emitted: true, key }
    }
}
