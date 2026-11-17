import type { Agent } from "@starci/nivoos-sdk"
import { TelegramTeam } from "../../accounts/telegram-team.account.ts"
import { keyOf } from "../../package-key.ts"
import { BookDemo } from "./book-demo/book-demo.workflow.ts"
import { SendConfirm } from "./book-demo/steps/send-confirm.step.ts"
import { SendEmail } from "./book-demo/steps/send-email.step.ts"
import { SendInvite } from "./book-demo/steps/send-invite.step.ts"
import { SendReminder } from "./book-demo/steps/send-reminder.step.ts"
import { Front } from "./front/front.workflow.ts"
import { SendAnswer } from "./front/steps/send-answer.step.ts"
import { Nurture } from "./nurture/nurture.workflow.ts"
import { SendFollowUp } from "./nurture/steps/send-follow-up.step.ts"
import { Qualify } from "./qualify/qualify.workflow.ts"
import { DailyReport } from "./report/report.workflow.ts"
import { Signal } from "./signal/signal.workflow.ts"
import { SendOpener } from "./signal/steps/send-opener.step.ts"

/**
 * `nivo-gtm.leads` (Chăm khách): the agent that takes NIVO's leads from the first message to a booked demo. It works on NIVO's Telegram bot (`telegram-team`; NIVO Tăng trưởng uses Telegram, never Zalo).
 * Its workflows: the front door (answers from the public brain), the signal (a lead that has not written yet), the qualification (the score), the nurture (follow-ups at the customer's pace), the demo
 * booking (fixed slots, confirmation on Telegram and by email) and the daily report.
 *
 * Every step that sends anything to a person outside the company starts in `ask`: a person approves the words first. The engine enforces it (a step whose act is `contact_message.send` or `mail.send` is
 * locked to `ask`; the workspace cannot switch it to `auto`), the `mode` below only states it where the agent is installed.
 */
export class Leads implements Agent {
    readonly key = keyOf("leads")
    readonly version = 3
    readonly title = { vi: "Chăm khách", en: "Leads" }
    readonly workflows = [Front, Signal, Qualify, Nurture, BookDemo, DailyReport]
    readonly providers = [TelegramTeam]
    readonly settings = [
        { workflow: Front, step: SendAnswer, mode: "ask" },
        { workflow: Signal, step: SendOpener, mode: "ask" },
        { workflow: Nurture, step: SendFollowUp, mode: "ask" },
        { workflow: BookDemo, step: SendInvite, mode: "ask" },
        { workflow: BookDemo, step: SendConfirm, mode: "ask" },
        { workflow: BookDemo, step: SendEmail, mode: "ask" },
        { workflow: BookDemo, step: SendReminder, mode: "ask" },
    ] as const
}
