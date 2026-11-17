import type { Agent } from "@starci/nivoos-sdk"
import { SheetsMarketing } from "../../accounts/sheets-marketing.account.ts"
import { TelegramTeam } from "../../accounts/telegram-team.account.ts"
import { keyOf } from "../../package-key.ts"
import { CalendarRound } from "./calendar-round/calendar-round.workflow.ts"
import { PerformanceRound } from "./performance-round/performance-round.workflow.ts"
import { PostDraftFlow } from "./post-draft/post-draft.workflow.ts"
import { Publish } from "./publish/publish.workflow.ts"
import { Send } from "./publish/steps/send.step.ts"
import { Replies } from "./replies/replies.workflow.ts"
import { SendReply } from "./replies/steps/send-reply.step.ts"

/**
 * `nivo-gtm.social` (Mạng xã hội): the social agent of NIVO Tăng trưởng, nested in its workspace. It plans the week's calendar, drafts posts, publishes them on time to the NIVO Telegram channel, answers comments from the public brain and
 * reports the week. Facebook, TikTok and YouTube are the provider seam (`providers/pending-channels.ts`): "chờ kết nối". Accountable person: the content lead (decision D5).
 * What leaves the company asks a person first: the post (`publish.send`) and the public reply (`replies.send-reply`) run in `ask` mode (the engine keeps them locked there). Every other step is internal and runs `auto`.
 */
export class Social implements Agent {
    readonly key = keyOf("social")
    readonly version = 2
    readonly title = { vi: "Mạng xã hội", en: "Social media" }
    readonly workflows = [CalendarRound, PostDraftFlow, Publish, Replies, PerformanceRound]
    readonly providers = [TelegramTeam, SheetsMarketing]
    readonly settings = [
        { workflow: Publish, step: Send, mode: "ask" },
        { workflow: Replies, step: SendReply, mode: "ask" },
    ] as const
}
