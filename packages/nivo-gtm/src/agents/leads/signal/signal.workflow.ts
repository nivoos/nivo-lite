import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { LeadSignalData } from "../../../common/events/lead-signal.event.ts"
import { keyOf } from "../../../package-key.ts"
import { LeadRef } from "../common/find-lead.cell.ts"
import { SendLineOutput } from "../common/send-line.cell.ts"
import { TouchLeadOutput } from "../common/touch-lead.cell.ts"
import { OpenerOutput } from "./opener.cell.ts"
import { RetryDecisionOutput } from "../../../common/recover/retry-decision.cell.ts"
import { ParkAlertOutput } from "../../../common/recover/park-alert.cell.ts"
import { Hear } from "./steps/hear.step.ts"
import { FindLead } from "./steps/find-lead.step.ts"
import { IsKnown } from "./steps/is-known.step.ts"
import { OpenLead } from "./steps/open-lead.step.ts"
import { IsReachable } from "./steps/is-reachable.step.ts"
import { Opener } from "./steps/opener.step.ts"
import { SendOpener } from "./steps/send-opener.step.ts"
import { Touch } from "./steps/touch.step.ts"
import { EndDoNotContact } from "./steps/end-do-not-contact.step.ts"
import { EndDeclined } from "./steps/end-declined.step.ts"
import { EndOpened } from "./steps/end-opened.step.ts"
import { OkOpenLead } from "./steps/ok-open-lead.step.ts"
import { OkOpener } from "./steps/ok-opener.step.ts"
import { SentSendOpener } from "./steps/sent-send-opener.step.ts"
import { HeldSendOpener } from "./steps/held-send-opener.step.ts"
import { OkTouch } from "./steps/ok-touch.step.ts"
import { Retry } from "./steps/retry.step.ts"
import { IsAgain } from "./steps/is-again.step.ts"
import { RetryWait } from "./steps/retry-wait.step.ts"
import { Resume1 } from "./steps/resume1.step.ts"
import { Resume2 } from "./steps/resume2.step.ts"
import { Resume3 } from "./steps/resume3.step.ts"
import { Resume4 } from "./steps/resume4.step.ts"
import { ParkFailed } from "./steps/park-failed.step.ts"
import { EndParked } from "./steps/end-parked.step.ts"

/** The one state object of a run: the signal that opened it (appended), the lead, the opener and what each step did. */
export const State = z.strictObject({
    signals: z.array(LeadSignalData).max(20).optional(),
    lead: LeadRef.optional(),
    opener: OpenerOutput.optional(),
    sent: SendLineOutput.optional(),
    touched: TouchLeadOutput.optional(),
    retry: RetryDecisionOutput.optional(),
    alert: ParkAlertOutput.optional(),
})
export type SignalItem = z.infer<typeof LeadSignalData>

/**
 * `nivo-gtm.leads-signal` (Tín hiệu khách): someone showed interest where we did not talk to them yet (a comment Social saw, an ad form, a sheet row). The lead is found or opened, the opener is
 * written from the PUBLIC brain and the source, a person approves it, it is sent, and the lead is touched. A lead that asked not to be contacted ends the run.
 *
 * Failure paths (the recovery rule): a step that is refused (a model that declines or has no credit, an object write that is stale or refused, a send the channel refuses for another reason than a held route) is
 * retried `retries` times (default 3) `retryMinutes` apart (customer settings of `retry-decision`), then the run posts ONE alert card to the team room and ends `parked`. Only a refusal the callee DECLARES can be handled this way;
 * an undeclared failure still stops the run at its node for a person.
 */
export class Signal implements Workflow<typeof State> {
    readonly key = keyOf("leads-signal")
    readonly version = 2
    readonly title = { vi: "Tín hiệu khách", en: "Lead signal" }
    readonly state = State
    readonly append = ["signals"] as const
    readonly start = Hear
    readonly steps = [Hear, FindLead, IsKnown, OpenLead, IsReachable, Opener, SendOpener, Touch, EndDoNotContact, EndDeclined, EndOpened, OkOpenLead, OkOpener, SentSendOpener, HeldSendOpener, OkTouch, Retry, IsAgain, RetryWait, Resume1, Resume2, Resume3, Resume4, ParkFailed, EndParked]
}
