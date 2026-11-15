import { Injectable } from "@nestjs/common"
import { ConnectionSecretReadsService } from "@modules/domain/connections"
import type { TelegramFileAddress } from "./telegram-inbox.contracts"
import type { TelegramMessageFile } from "./telegram-message.trigger"
import { InjectTelegram, type TelegramClient } from "@modules/integrations/telegram"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { TelegramInboxLogEvent } from "./telegram-inbox.log-events"

/** The largest file a bot may download (Bot API `getFile`: "bots can download files of up to 20MB in size"). */
export const TELEGRAM_DOWNLOAD_MAX_BYTES: number = 20 * 1024 * 1024

@Injectable()
/**
 * Turns the file ids of a Telegram message into the addresses the shop reads them from once (Bot API `getFile`, with the bot of the
 * connection the update came in on). A file Telegram will not give for good (a refusal), one too large for a bot, or a connection whose bot
 * cannot be opened stays on the line without an address, so a step is told a picture came that nobody saw. A call that failed on the way or
 * on a busy Telegram does the same: it never fails the delivery job. The address carries the bot
 * token and only goes to the guarded file fetch, which keeps the bytes under the shop's own path.
 */
export class TelegramFilesService {
    constructor(
        private readonly secrets: ConnectionSecretReadsService,
        @InjectTelegram() private readonly telegram: TelegramClient,
        @InjectLogger() private readonly logger: Logger,
    ) {}

    /** The attachments of the message in order, each with its download address or an empty one. */
    async addressesOf(
        connectionId: string,
        attachments: ReadonlyArray<TelegramMessageFile>,
    ): Promise<ReadonlyArray<TelegramFileAddress>> {
        if (attachments.length === 0) return []
        const secret = await this.secrets.secretOf(connectionId, "telegram")
        const token = secret.kind === "ok" ? secret.value.credential : ""
        if (token === "") this.logger.warn(TelegramInboxLogEvent.FileNotAddressed, { connectionId, reason: "no_bot" })
        return Promise.all(attachments.map((attachment) => this.addressOf(connectionId, token, attachment)))
    }

    private async addressOf(
        connectionId: string,
        token: string,
        attachment: TelegramMessageFile,
    ): Promise<TelegramFileAddress> {
        // A part with no file (a location, a contact) is handed on as its typed part: there is nothing to ask Telegram for.
        if (attachment.contentType !== undefined)
            return { kind: attachment.kind, url: "", name: attachment.name, contentType: attachment.contentType }
        const unaddressed = { kind: attachment.kind, url: "", name: attachment.name }
        if (token === "") return unaddressed
        if (attachment.size !== null && attachment.size > TELEGRAM_DOWNLOAD_MAX_BYTES) {
            this.logger.warn(TelegramInboxLogEvent.FileNotAddressed, { connectionId, reason: "too_large" })
            return unaddressed
        }
        try {
            const url = await this.telegram.fileUrl(token, attachment.fileId)
            if (url === "")
                this.logger.warn(TelegramInboxLogEvent.FileNotAddressed, { connectionId, reason: "no_file_path" })
            return { ...unaddressed, url }
        } catch (cause) {
            // A Telegram that fails or is busy is no reason to lose the customer's message: the file stays on the line without an address
            // (customer files records it as a typed, reported not-kept entry), R72 DEF-7.
            this.logger.warn(TelegramInboxLogEvent.FileNotAddressed, {
                connectionId,
                reason: cause instanceof Error ? cause.name : "unknown",
            })
            return unaddressed
        }
    }
}
