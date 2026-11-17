import { z } from "zod"
import type { EventKind } from "@starci/nivoos-sdk"
import { keyOf } from "../../package-key.ts"

/** What the event carries. */
export const ContentPublishedData = z.strictObject({ publicationId: z.string().min(1), contentId: z.string().min(1), channel: z.string().max(500) })

/**
 * `nivo-gtm.content.published`: a publication went out on its channel. Internal, on the subject `publication:<id>`; the emitter keys it by the object and the transition, so a repeat emit is one event.
 */
export class ContentPublished implements EventKind<typeof ContentPublishedData> {
    readonly key = keyOf("content.published")
    readonly version = 1
    readonly title = { vi: "Nội dung đã đăng", en: "Content published" }
    readonly event = ContentPublishedData
    readonly subjectKind = "publication"
    readonly vias = ["internal"] as const
}
