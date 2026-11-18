import { z } from "zod"
import type { EventKind } from "@starci/nivoos-sdk"
import { keyOf } from "../../package-key.ts"

/** What the event carries. */
export const LeadReadyData = z.strictObject({ leadId: z.string().min(1).max(80), reason: z.string().max(500) })

/**
 * `nivo-gtm.lead.ready`: a lead asked for a demo or the price with fit signals: qualify and book-demo take it. Internal, on the subject `lead:<id>`; the emitter keys it by the object and the transition, so a repeat emit is one event.
 */
export class LeadReady implements EventKind<typeof LeadReadyData> {
    readonly key = keyOf("lead.ready")
    readonly version = 1
    readonly title = { vi: "Khách sẵn sàng", en: "Lead ready" }
    readonly event = LeadReadyData
    readonly subjectKind = "lead"
    readonly vias = ["internal"] as const
}
