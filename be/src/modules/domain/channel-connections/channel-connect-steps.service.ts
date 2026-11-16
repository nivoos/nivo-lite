import { Injectable, type OnModuleInit } from "@nestjs/common"
import { AccountConnectService, ConnectionsService, type AccountConnectStep, type ConnectionRecord } from "@modules/domain/connections"
import { ChannelSetupError, ChannelSetupErrorCode, InjectChannelSetupClient, type ChannelSetupClient } from "@modules/integrations/channel-setup"
import { parseJsonText } from "@modules/platform/primitives"
import { ChannelConnectionsError, ChannelConnectionsErrorCode } from "./errors/channel-connections.error"

/** The setup failure as the capability's own typed error (the same mapping the wizard's checks use). */
const mapped = (error: unknown): ChannelConnectionsError => {
    if (error instanceof ChannelSetupError) {
        if (error.code === ChannelSetupErrorCode.CredentialRejected) return new ChannelConnectionsError({ code: ChannelConnectionsErrorCode.TokenRejected, cause: error })
        if (error.code === ChannelSetupErrorCode.Unreachable) return new ChannelConnectionsError({ code: ChannelConnectionsErrorCode.Network, cause: error })
    }
    return new ChannelConnectionsError({ code: ChannelConnectionsErrorCode.Failed, cause: error })
}

/** One text member of a stored JSON credential, or undefined. */
const memberOf = (plain: string, name: string): string | undefined => {
    const read = parseJsonText(plain)
    if (!read.ok || typeof read.value !== "object" || read.value === null) return undefined
    const value: unknown = (read.value as Record<string, unknown>)[name]
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined
}

@Injectable()
/**
 * The CONNECT STEPS of the chat channels and money feeds this capability serves, declared once at boot to the one door
 * (`AccountConnectService`). The console's wizards and the seed both reach a vendor only through these:
 * - Telegram: `getMe` with the stored token (verifies it), refuses a bot another account holds, stores the bot's id and username (the
 *   public facts an inbound update finds its account by), then `setWebhook` to this account's own address with its stored webhook secret.
 * - payOS: confirms this account's webhook address with the stored client id and API key (payOS then sends payment notices there).
 * SePay, Casso and Zalo OA declare none here: SePay's and Casso's webhook is entered by the owner on the vendor's own page; a Zalo OA is
 * connected by the owner's consent in the console.
 */
export class ChannelConnectStepsService implements OnModuleInit {
    constructor(
        private readonly door: AccountConnectService,
        private readonly connections: ConnectionsService,
        @InjectChannelSetupClient() private readonly setup: ChannelSetupClient,
    ) {}

    onModuleInit(): void {
        this.door.register(this.telegram())
        this.door.register(this.payos())
    }

    private telegram(): AccountConnectStep {
        return {
            provider: "telegram",
            does: "Telegram getMe (verify the token), store the bot id + username, setWebhook to the account's address with its webhook secret",
            connect: async (account, origin) => {
                const secret = await this.secretOf(account)
                let me
                try {
                    me = await this.setup.telegramGetMe(secret.plain)
                } catch (error) {
                    throw mapped(error)
                }
                // One bot has one webhook: a bot another account holds (here or in another workspace) is refused, never taken over.
                const held = await this.connections.findLiveByMeta("telegram", "bot_id", me.id)
                if (held !== null && held.id !== account.id) throw new ChannelConnectionsError({ code: ChannelConnectionsErrorCode.BotInUse })
                await this.connections.patch(account.workspaceId, account.id, { meta: { ...account.meta, bot_id: me.id, bot_username: me.username } })
                try {
                    await this.setup.telegramSetWebhook(secret.plain, this.connections.webhookUrl("telegram", account.id, origin), secret.webhookSecret)
                } catch (error) {
                    throw new ChannelConnectionsError({ code: ChannelConnectionsErrorCode.WebhookRefused, cause: error })
                }
            },
        }
    }

    private payos(): AccountConnectStep {
        return {
            provider: "payos",
            does: "payOS confirm-webhook of the account's address with its client id + API key",
            connect: async (account, origin) => {
                const secret = await this.secretOf(account)
                const clientId = memberOf(secret.plain, "clientId")
                const apiKey = memberOf(secret.plain, "apiKey")
                if (clientId === undefined || apiKey === undefined) throw new ChannelConnectionsError({ code: ChannelConnectionsErrorCode.KeysInvalid })
                try {
                    await this.setup.payosConfirmWebhook({ clientId, apiKey }, this.connections.webhookUrl("payos", account.id, origin))
                } catch (error) {
                    throw new ChannelConnectionsError({ code: ChannelConnectionsErrorCode.PayosConfirmRefused, cause: error })
                }
            },
        }
    }

    private async secretOf(account: ConnectionRecord): Promise<{ readonly plain: string; readonly webhookSecret: string }> {
        const secret = await this.connections.readSecret(account.id)
        if (secret === null) throw new ChannelConnectionsError({ code: ChannelConnectionsErrorCode.KeysInvalid })
        return secret
    }
}
