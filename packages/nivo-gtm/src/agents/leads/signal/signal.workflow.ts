import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { LeadSignalData } from "../../../common/events/lead-signal.event.ts"
import { keyOf } from "../../../package-key.ts"
import { LeadRef } from "../common/find-lead.cell.ts"
import { SendLineOutput } from "../common/send-line.cell.ts"
import { TouchLeadOutput } from "../common/touch-lead.cell.ts"
import { OpenerOutput } from "./opener.cell.ts"
import { Hear } from "./steps/hear.step.ts"
import { FindLead } from "./steps/find-lead.step.ts"
import { IsKnown } from "./steps/is-known.step.ts"
import { OpenLead } from "./steps/open-lead.step.ts"
import { IsReachable } from "./steps/is-reachable.step.ts"
import { Opener } from "./steps/opener.step.ts"
import { SendOpener } from "./steps/send-opener.step.ts"
import { IsSent } from "./steps/is-sent.step.ts"
import { Touch } from "./steps/touch.step.ts"
import { EndDoNotContact } from "./steps/end-do-not-contact.step.ts"
import { EndDeclined } from "./steps/end-declined.step.ts"
import { EndOpened } from "./steps/end-opened.step.ts"

/** The one state object of a run: the signal that opened it (appended), the lead, the opener and what each step did. */
export const State = z.strictObject({
    signals: z.array(LeadSignalData).max(20).optional(),
    lead: LeadRef.optional(),
    opener: OpenerOutput.optional(),
    sent: SendLineOutput.optional(),
    touched: TouchLeadOutput.optional(),
})
export type SignalItem = z.infer<typeof LeadSignalData>

/**
 * `nivo-gtm.leads-signal` (Tín hiệu khách): someone showed interest where we did not talk to them yet (a comment Social saw, an ad form, a sheet row). The lead is found or opened, the opener is
 * written from the PUBLIC brain and the source, a person approves it, it is sent, and the lead is touched. A lead that asked not to be contacted ends the run.
 */
export class Signal implements Workflow<typeof State> {
    readonly key = keyOf("leads-signal")
    readonly version = 1
    readonly title = { vi: "Tín hiệu khách", en: "Lead signal" }
    readonly state = State
    readonly append = ["signals"] as const
    readonly start = Hear
    readonly steps = [Hear, FindLead, IsKnown, OpenLead, IsReachable, Opener, SendOpener, IsSent, Touch, EndDoNotContact, EndDeclined, EndOpened]
}
