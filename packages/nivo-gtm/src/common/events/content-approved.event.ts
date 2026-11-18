import { z } from "zod"
import type { EventKind } from "@starci/nivoos-sdk"
import { keyOf } from "../../package-key.ts"

/** What the event carries. */
export const ContentApprovedData = z.strictObject({ contentId: z.string().min(1).max(80), kind: z.string().max(500) })

/**
 * `nivo-gtm.content.approved`: a content item was approved by its reviewer (Social schedules it). Internal, on the subject `content:<id>`; the emitter keys it by the object and the transition, so a repeat emit is one event.
 */
export class ContentApproved implements EventKind<typeof ContentApprovedData> {
    readonly key = keyOf("content.approved")
    readonly version = 1
    readonly title = { vi: "Nội dung đã duyệt", en: "Content approved" }
    readonly event = ContentApprovedData
    readonly subjectKind = "content"
    readonly vias = ["internal"] as const
}
