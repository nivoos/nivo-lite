import { Injectable } from "@nestjs/common"
import { ConnectionsService } from "@modules/domain/connections"
import { InjectMetaClient, type MetaClient, type SendResult } from "@modules/integrations/meta"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { MetaConnectionsLogEvent } from "./meta-connections.log-events"
import { parseMetaSecret } from "./meta-secret.policy"

/** Where a send goes, as this provider reads it: the person's id on the channel (with an archive suffix after a colon) and the Page connection. */
export interface MetaSendTarget {
    /** The workspace. */
    readonly workspaceId: string
    /** The channel key: facebook or instagram. */
    readonly channel: string
    /** The customer's id on the channel. */
    readonly externalId: string | null
    /** The Page connection the message goes through. */
    readonly connectionId: string | null
}

/** The customer id on the channel is the part before the colon (archived conversations carry a suffix). */
const personOf = (externalId: string): string => {
    const end = externalId.length
    let colon = -1
    for (let at = end - 1; at >= 0; at -= 1) {
        const char = externalId.charAt(at)
        if (/[\r\n\u2028\u2029]/u.test(char)) break
        if (char === ":") colon = at
    }
    return colon < 0 ? externalId : externalId.slice(0, colon)
}

@Injectable()
/**
 * Sends the company side of a Facebook or Instagram conversation through the Page of the connection the conversation came in on. It is the
 * live route behind the Meta customer-send port (`MetaCustomerSendService`); the engine reaches it only for a live account.
 */
export class MetaChannelSender {
    constructor(
        @InjectMetaClient() private readonly meta: MetaClient,
        private readonly connections: ConnectionsService,
        @InjectLogger() private readonly logger: Logger,
    ) {}

    /** Pushes the text to the customer; false when the Page is gone, the credential is unreadable or Meta refused. Never throws. */
    async send(conversation: MetaSendTarget, text: string): Promise<boolean> {
        return (await this.deliver(conversation, text))?.ok === true
    }

    /**
     * Pushes the text to the customer and answers Meta's typed answer (the message ids, or the reason it did not go and how many parts
     * of a long text it had taken), or null when the Page is gone or its credential unreadable (nothing asked of Meta). Never throws.
     */
    async deliver(conversation: MetaSendTarget, text: string): Promise<SendResult | null> {
        const platform = conversation.channel === "instagram" ? "instagram" : "facebook"
        if (conversation.connectionId === null || conversation.externalId === null) return null
        const connectionId = conversation.connectionId
        const unavailable = (cause: unknown): null => {
            this.logger.error(MetaConnectionsLogEvent.SendUnavailable, cause, { connectionId })
            return null
        }
        const connection = await this.connections.find(conversation.workspaceId, connectionId).catch((cause) => unavailable(cause))
        const sealed = connection === null ? null : await this.connections.readSecret(connection.id).catch((cause) => unavailable(cause))
        const secret = sealed === null ? {} : parseMetaSecret(sealed.plain)
        if (connection === null || secret.pageId === undefined || secret.pageToken === undefined) return null
        return this.meta.deliverMessage(
            { pageId: secret.pageId, pageToken: secret.pageToken, igId: connection.meta.ig_id ?? null },
            platform,
            personOf(conversation.externalId),
            text,
            "standard",
        )
    }
}
