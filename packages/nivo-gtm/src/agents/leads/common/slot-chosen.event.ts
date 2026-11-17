import { z } from "zod"
import type { EventKind } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"

/** What the event carries: who chose, what they wrote and the email address they gave (empty when none). */
export const SlotChosenData = z.strictObject({ leadId: z.string().min(1), text: z.string().max(500), email: z.string().max(200) })

/**
 * `nivo-gtm.lead.slot-chosen`: a lead answered the demo invitation (the front door heard them pick a time). Internal, on the subject `lead:<code>`; book-demo takes it, reads which of the
 * free slots they meant and books it. It is the hand-off the conversation hold (E1) will make unnecessary: until then the invitation run ends and this event wakes the next.
 */
export class SlotChosen implements EventKind<typeof SlotChosenData> {
    readonly key = keyOf("lead.slot-chosen")
    readonly version = 1
    readonly title = { vi: "Khách chọn giờ demo", en: "Lead chose a demo slot" }
    readonly event = SlotChosenData
    readonly subjectKind = "lead"
    readonly vias = ["internal"] as const
}
