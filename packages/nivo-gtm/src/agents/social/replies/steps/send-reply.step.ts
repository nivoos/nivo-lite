import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialSendReply as SendReplyCell } from "../send-reply.cell.ts"
import { TelegramTeam } from "../../../../accounts/telegram-team.account.ts"
import { Replied } from "./replied.step.ts"
import { Declined } from "./declined.step.ts"
import type { State } from "../replies.workflow.ts"

/** The ask step: a person approves the reply before it leaves the company. */
export class SendReply extends NodeRun(SendReplyCell)<typeof State> {
    override readonly account = TelegramTeam
    override readonly input = (s: StateView<typeof State>) => ({ chatId: s.messages.at(-1).chatId, messageId: s.messages.at(-1).messageId, text: s.answer.reply })
    override readonly into = ["sent"] as const
    override readonly next = Replied
    override readonly onDeclined = Declined
}
