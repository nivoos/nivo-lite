import { z } from "zod"
import type { EventKind } from "@starci/nivoos-sdk"
import { keyOf } from "../../package-key.ts"

/** What the event carries. */
export const DemoDoneData = z.strictObject({ leadId: z.string().min(1), demoId: z.string().min(1), note: z.string().max(500) })

/**
 * `nivo-gtm.demo.done`: a demo was held (Deals opens the deal from it). Internal, on the subject `lead:<id>`; the emitter keys it by the object and the transition, so a repeat emit is one event.
 */
export class DemoDone implements EventKind<typeof DemoDoneData> {
    readonly key = keyOf("demo.done")
    readonly version = 1
    readonly title = { vi: "Demo xong", en: "Demo done" }
    readonly event = DemoDoneData
    readonly subjectKind = "lead"
    readonly vias = ["internal"] as const
}
