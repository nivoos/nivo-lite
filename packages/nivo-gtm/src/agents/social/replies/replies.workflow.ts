import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { TelegramMessage } from "@starci/nivoos-provider-templates/telegram/telegram.provider.cell"
import { AskTeamOutput } from "../common/ask-team.cell.ts"
import { SortOutput } from "./sort.cell.ts"
import { LeadSignalOutput } from "./lead-signal.cell.ts"
import { AnswerOutput } from "./answer.cell.ts"
import { SendReplyOutput } from "./send-reply.cell.ts"
import { keyOf } from "../../../package-key.ts"
import { Hear } from "./steps/hear.step.ts"
import { Sort } from "./steps/sort.step.ts"
import { IsSpam } from "./steps/is-spam.step.ts"
import { Spam } from "./steps/spam.step.ts"
import { IsComplaint } from "./steps/is-complaint.step.ts"
import { Notice } from "./steps/notice.step.ts"
import { Noticed } from "./steps/noticed.step.ts"
import { IsInterest } from "./steps/is-interest.step.ts"
import { Signal } from "./steps/signal.step.ts"
import { Answer } from "./steps/answer.step.ts"
import { IsAnswered } from "./steps/is-answered.step.ts"
import { Unanswered } from "./steps/unanswered.step.ts"
import { SendReply } from "./steps/send-reply.step.ts"
import { Declined } from "./steps/declined.step.ts"
import { Replied } from "./steps/replied.step.ts"

/** The one state object of a run. */
export const State = z.strictObject({
    messages: z.array(TelegramMessage).max(20).optional(),
    sorted: SortOutput.optional(),
    noticed: AskTeamOutput.optional(),
    signalled: LeadSignalOutput.optional(),
    answer: AnswerOutput.optional(),
    sent: SendReplyOutput.optional(),
})
/** A Telegram message the team account received, as the run keeps it. */
export type Message = z.infer<typeof TelegramMessage>

/**
 * `nivo-gtm.social-replies` (Trả lời bình luận): a comment in the discussion group of the NIVO Telegram channel opens a run (one per commenter; comments that arrive together are read together after a 20 s quiet). The comment is sorted
 * (question, interest, praise, complaint, spam): spam ends; a complaint is told to the team in a card; an interest also emits `nivo-gtm.lead.signal` (the Leads agent opens a lead). A question or praise is answered from the PUBLIC brain only,
 * and the reply is SENT in `ask` mode: a person approves every public reply. A person who declines ends the run `declined`.
 */
export class Replies implements Workflow<typeof State> {
    readonly key = keyOf("social-replies")
    readonly version = 2
    readonly title = { vi: "Trả lời bình luận", en: "Reply to comments" }
    readonly state = State
    readonly append = ["messages"] as const
    readonly start = Hear
    readonly steps = [
        Hear,
        Sort,
        IsSpam,
        Spam,
        IsComplaint,
        Notice,
        Noticed,
        IsInterest,
        Signal,
        Answer,
        IsAnswered,
        Unanswered,
        SendReply,
        Declined,
        Replied,
    ]
}
