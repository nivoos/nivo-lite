import { z } from "zod"
import type { EventKind } from "@starci/nivoos-sdk"
import { keyOf } from "../../package-key.ts"

/** What the event carries. */
export const LeadSignalData = z.strictObject({
    source: z.string().max(500),
    contactRef: z.string().max(500),
    note: z.string().max(500),
})

/**
 * `nivo-gtm.lead.signal`: someone showed interest (a comment, a sheet row, a form): Leads opens or touches a lead. Internal, on the subject `lead:<id>`; the emitter keys it by the object and the transition, so a repeat emit is one event.
 */
export class LeadSignal implements EventKind<typeof LeadSignalData> {
    readonly key = keyOf("lead.signal")
    readonly version = 1
    readonly title = { vi: "Tín hiệu khách", en: "Lead signal" }
    readonly event = LeadSignalData
    readonly subjectKind = "lead"
    readonly vias = ["internal"] as const
}
