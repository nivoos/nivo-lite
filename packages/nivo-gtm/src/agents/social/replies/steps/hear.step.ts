import { NodeWait, take } from "@starci/nivoos-sdk"
import { TelegramMessageReceived } from "@starci/nivoos-provider-templates/telegram/message-received.cell"
import { TelegramTeam } from "../../../../accounts/telegram-team.account.ts"
import { Sort } from "./sort.step.ts"
import type { State, Message } from "../replies.workflow.ts"

export class Hear extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(
            TelegramMessageReceived,
            { account: TelegramTeam, when: (items: Message[]) => items.filter((item) => (item.chatType === "group" || item.chatType === "supergroup") && item.fromIsBot === false) },
            (s, messages: Message[]) => { messages.forEach((message) => s.messages.push(message)) },
        ),
    ]
    override readonly quiet = { seconds: 20 }
    override readonly next = Sort
}
