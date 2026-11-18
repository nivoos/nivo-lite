import { z } from "zod"
import type { EventKind } from "@starci/nivoos-sdk"
import { keyOf } from "../../package-key.ts"

/** What the event carries. */
export const CutReadyData = z.strictObject({
    contentId: z.string().min(1).max(80),
    cutId: z.string().min(1).max(80),
    version: z.number().int().nonnegative(),
})

/**
 * `nivo-gtm.cut.ready`: a video cut is ready for review (Studio emits it, review-cut takes it). Internal, on the subject `content:<id>`; the emitter keys it by the object and the transition, so a repeat emit is one event.
 */
export class CutReady implements EventKind<typeof CutReadyData> {
    readonly key = keyOf("cut.ready")
    readonly version = 1
    readonly title = { vi: "Bản dựng sẵn sàng", en: "Cut ready" }
    readonly event = CutReadyData
    readonly subjectKind = "content"
    readonly vias = ["internal"] as const
}
