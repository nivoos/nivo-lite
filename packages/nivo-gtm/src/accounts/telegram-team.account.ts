import { env, secret, type ProviderAccount } from "@starci/nivoos-sdk"
import { TelegramProvider } from "@starci/nivoos-provider-templates/telegram/telegram.provider.cell"

/**
 * The team's Telegram bot `telegram-team`: alerts and approvals on the phone, the NIVO channel and its discussion group. NIVO Tăng trưởng uses Telegram, never Zalo (only NIVO Web uses Zalo).
 * The bot username is read from `TELEGRAM_TEAM_BOT_USERNAME`, the token and the webhook secret from the secrets file.
 */
export class TelegramTeam implements ProviderAccount<typeof TelegramProvider> {
    readonly key = "telegram-team"
    readonly provider = TelegramProvider
    readonly title = { vi: "Bot Telegram của đội", en: "Team Telegram bot" }
    readonly fields = { botUsername: env("TELEGRAM_TEAM_BOT_USERNAME") }
    readonly secrets = {
        botToken: secret("TELEGRAM_TEAM_BOT_TOKEN"),
        webhookSecret: secret("TELEGRAM_TEAM_WEBHOOK_SECRET"),
    }
}
