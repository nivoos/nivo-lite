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
import { IsSent } from "./steps/is-sent.step.ts"
import { Readiness } from "./steps/readiness.step.ts"
import { IsReady } from "./steps/is-ready.step.ts"
import { EmitReady } from "./steps/emit-ready.step.ts"
import { EndSpam } from "./steps/end-spam.step.ts"
import { EndSlot } from "./steps/end-slot.step.ts"
import { EndSupport } from "./steps/end-support.step.ts"
import { EndDeclined } from "./steps/end-declined.step.ts"
import { EndAnswered } from "./steps/end-answered.step.ts"
import { EndReady } from "./steps/end-ready.step.ts"

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
})
export type Message = z.infer<typeof TelegramMessage>

/**
 * `nivo-gtm.leads-front` (Tiếp nhận khách): the front door of NIVO's Telegram bot. A person's message opens it; the lead is found or opened, what they want is understood, and the lead is touched.
 * A pick of a demo time is handed to the booking (`SlotChosen`); a customer who needs help goes to the team; anything else is answered from the PUBLIC brain, the answer is sent after a person
 * approves it, and a lead that asked for a demo or a price (or has been touched enough times) is announced as ready, which starts the scoring. A send the channel refuses ends `declined`;
 * a question the public brain does not answer stops the run at the answer for a person.
 */
export class Front implements Workflow<typeof State> {
    readonly key = keyOf("leads-front")
    readonly version = 1
    readonly title = { vi: "Tiếp nhận khách", en: "Take a lead's message" }
    readonly state = State
    readonly append = ["messages"] as const
    readonly start = Hear
    readonly steps = [Hear, FindLead, IsKnown, OpenLead, Understand, IsSpam, Touch, IsSlot, EmitSlot, IsSupport, NoticeSupport, Answer, SendAnswer, IsSent, Readiness, IsReady, EmitReady, EndSpam, EndSlot, EndSupport, EndDeclined, EndAnswered, EndReady]
}
