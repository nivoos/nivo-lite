import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { TelegramMessage } from "@starci/nivoos-provider-templates/telegram/telegram.provider.cell"
import { keyOf } from "../../../package-key.ts"
import { LeadRef } from "../common/find-lead.cell.ts"
import { EmitLeadReadyOutput } from "../common/emit-lead-ready.cell.ts"
import { PostNoticeOutput } from "../common/post-notice.cell.ts"
import { SendLineOutput } from "../common/send-line.cell.ts"
import { TouchLeadOutput } from "../common/touch-lead.cell.ts"
import { AnswerOutput } from "./answer.cell.ts"
import { ReadinessOutput } from "./readiness.cell.ts"
import { UnderstandOutput } from "./understand.cell.ts"
import { RetryDecisionOutput } from "../../../common/recover/retry-decision.cell.ts"
import { ParkAlertOutput } from "../../../common/recover/park-alert.cell.ts"
import { Hear } from "./steps/hear.step.ts"
import { FindLead } from "./steps/find-lead.step.ts"
import { IsKnown } from "./steps/is-known.step.ts"
import { OpenLead } from "./steps/open-lead.step.ts"
import { Understand } from "./steps/understand.step.ts"
import { IsSpam } from "./steps/is-spam.step.ts"
import { Touch } from "./steps/touch.step.ts"
import { IsSlot } from "./steps/is-slot.step.ts"
import { EmitSlot } from "./steps/emit-slot.step.ts"
import { IsSupport } from "./steps/is-support.step.ts"
import { NoticeSupport } from "./steps/notice-support.step.ts"
import { Answer } from "./steps/answer.step.ts"
import { SendAnswer } from "./steps/send-answer.step.ts"
import { Readiness } from "./steps/readiness.step.ts"
import { IsReady } from "./steps/is-ready.step.ts"
import { EmitReady } from "./steps/emit-ready.step.ts"
import { EndSpam } from "./steps/end-spam.step.ts"
import { EndSlot } from "./steps/end-slot.step.ts"
import { EndSupport } from "./steps/end-support.step.ts"
import { EndDeclined } from "./steps/end-declined.step.ts"
import { EndAnswered } from "./steps/end-answered.step.ts"
import { EndReady } from "./steps/end-ready.step.ts"
import { OkOpenLead } from "./steps/ok-open-lead.step.ts"
import { OkUnderstand } from "./steps/ok-understand.step.ts"
import { OkTouch } from "./steps/ok-touch.step.ts"
import { OkAnswer } from "./steps/ok-answer.step.ts"
import { SentSendAnswer } from "./steps/sent-send-answer.step.ts"
import { HeldSendAnswer } from "./steps/held-send-answer.step.ts"
import { HasAnswer } from "./steps/has-answer.step.ts"
import { ParkNoAnswer } from "./steps/park-no-answer.step.ts"
import { Retry } from "./steps/retry.step.ts"
import { IsAgain } from "./steps/is-again.step.ts"
import { RetryWait } from "./steps/retry-wait.step.ts"
import { Resume1 } from "./steps/resume1.step.ts"
import { Resume2 } from "./steps/resume2.step.ts"
import { Resume3 } from "./steps/resume3.step.ts"
import { Resume4 } from "./steps/resume4.step.ts"
import { Resume5 } from "./steps/resume5.step.ts"
import { ParkFailed } from "./steps/park-failed.step.ts"
import { EndParked } from "./steps/end-parked.step.ts"

/** The one state object of a run: the person's messages that opened it (appended), the lead, what was understood, and what each route did. */
export const State = z.strictObject({
    messages: z.array(TelegramMessage).max(50).optional(),
    lead: LeadRef.optional(),
    understood: UnderstandOutput.optional(),
    touched: TouchLeadOutput.optional(),
    notice: PostNoticeOutput.optional(),
    answer: AnswerOutput.optional(),
    sent: SendLineOutput.optional(),
    readiness: ReadinessOutput.optional(),
    emitted: EmitLeadReadyOutput.optional(),
    retry: RetryDecisionOutput.optional(),
    alert: ParkAlertOutput.optional(),
})
export type Message = z.infer<typeof TelegramMessage>

/**
 * `nivo-gtm.leads-front` (Tiếp nhận khách): the front door of NIVO's Telegram bot. A person's message opens it; the lead is found or opened, what they want is understood, and the lead is touched.
 * A pick of a demo time is handed to the booking (`SlotChosen`); a customer who needs help goes to the team; anything else is answered from the PUBLIC brain, the answer is sent after a person
 * approves it, and a lead that asked for a demo or a price (or has been touched enough times) is announced as ready, which starts the scoring. A send the channel refuses ends `declined`;
 * a question the public brain does not answer stops the run at the answer for a person.
 *
 * Failure paths (the recovery rule): a step that is refused (a model that declines or has no credit, an object write that is stale or refused, a send the channel refuses for another reason than a held route) is
 * retried `retries` times (default 3) `retryMinutes` apart (customer settings of `retry-decision`), then the run posts ONE alert card to the team room and ends `parked`. Only a refusal the callee DECLARES can be handled this way;
 * an undeclared failure still stops the run at its node for a person.
 */
export class Front implements Workflow<typeof State> {
    readonly key = keyOf("leads-front")
    readonly version = 2
    readonly title = { vi: "Tiếp nhận khách", en: "Take a lead's message" }
    readonly state = State
    readonly append = ["messages"] as const
    readonly start = Hear
    readonly steps = [Hear, FindLead, IsKnown, OpenLead, Understand, IsSpam, Touch, IsSlot, EmitSlot, IsSupport, NoticeSupport, Answer, SendAnswer, Readiness, IsReady, EmitReady, EndSpam, EndSlot, EndSupport, EndDeclined, EndAnswered, EndReady, OkOpenLead, OkUnderstand, OkTouch, OkAnswer, SentSendAnswer, HeldSendAnswer, HasAnswer, ParkNoAnswer, Retry, IsAgain, RetryWait, Resume1, Resume2, Resume3, Resume4, Resume5, ParkFailed, EndParked]
}
