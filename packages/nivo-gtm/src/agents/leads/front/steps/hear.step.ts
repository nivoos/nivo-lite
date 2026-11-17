import { NodeWait, take } from "@starci/nivoos-sdk"
import { TelegramMessageReceived } from "@starci/nivoos-provider-templates/telegram/message-received.cell"
import { TelegramTeam } from "../../../../accounts/telegram-team.account.ts"
import type { State, Message } from "../front.workflow.ts"
import { FindLead } from "./find-lead.step.ts"

/** The start: a person's private message to NIVO's Telegram bot opens the run; the messages of a burst (20 s of quiet) are read together. A group, a channel and a bot are not leads. */
export class Hear extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(TelegramMessageReceived, { account: TelegramTeam, when: (items: Message[]) => items.filter((item) => item.chatType === "private" && !item.fromIsBot) }, (s, messages: Message[]) => { messages.forEach((message) => s.messages.push(message)) }),
    ]
    override readonly quiet = { seconds: 20 }
    override readonly next = FindLead
}
