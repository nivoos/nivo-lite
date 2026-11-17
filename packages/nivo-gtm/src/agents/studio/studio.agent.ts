import type { Agent } from "@starci/nivoos-sdk"
import { DriveMarketing } from "../../accounts/drive-marketing.account.ts"
import { SheetsMarketing } from "../../accounts/sheets-marketing.account.ts"
import { TelegramTeam } from "../../accounts/telegram-team.account.ts"
import { keyOf } from "../../package-key.ts"

/**
 * `nivo-gtm.studio`: Xưởng video (accountable person: the content lead). Skeleton of the first slice: it holds its accounts (the marketing Drive and Sheets, the team Telegram bot) and no workflow yet;
 * idea-round, pick, script, produce and review-cut arrive with the Studio lane.
 */
export class Studio implements Agent {
    readonly key = keyOf("studio")
    readonly version = 1
    readonly title = { vi: "Xưởng video", en: "Video studio" }
    readonly workflows = []
    readonly providers = [TelegramTeam, DriveMarketing, SheetsMarketing]
}
