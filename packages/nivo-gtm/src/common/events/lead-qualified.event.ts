import { z } from "zod"
import type { EventKind } from "@starci/nivoos-sdk"
import { keyOf } from "../../package-key.ts"

/** What the event carries. */
export const LeadQualifiedData = z.strictObject({
    leadId: z.string().min(1).max(80),
    score: z.number().int().nonnegative(),
})

/**
 * `nivo-gtm.lead.qualified`: a lead scored above the qualify line. Internal, on the subject `lead:<id>`; the emitter keys it by the object and the transition, so a repeat emit is one event.
 */
export class LeadQualified implements EventKind<typeof LeadQualifiedData> {
    readonly key = keyOf("lead.qualified")
    readonly version = 1
    readonly title = { vi: "Khách đạt chuẩn", en: "Lead qualified" }
    readonly event = LeadQualifiedData
    readonly subjectKind = "lead"
    readonly vias = ["internal"] as const
}
