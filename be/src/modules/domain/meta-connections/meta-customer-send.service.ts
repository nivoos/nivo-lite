import { Injectable } from "@nestjs/common"
import { ChannelsError, ChannelsErrorCode } from "@modules/domain/channels"
import type { ChannelTarget, CustomerSendPort, CustomerSendRequest, DeliveryResult } from "@modules/domain/channels"
import type { ConnectionRecord } from "@modules/domain/connections"
import type { SendResult } from "@modules/integrations/meta"
import { MetaChannelSender } from "./meta-channel-sender.service"

/** Why Meta did not take a message, as its typed answer names it. */
type MetaFailure = Extract<SendResult, { readonly ok: false }>["reason"]

/** The receipt of a message the Page sent. */
const DELIVERED: DeliveryResult = { delivered: true, failure: null, outcome: "acknowledged" }

/** The receipt of a message the Page did not send for any other reason: the outcome is not known, as the engine always read it. */
const UNKNOWN: DeliveryResult = { delivered: false, failure: null, outcome: "ambiguous" }

/**
 * Meta's typed reasons that say the Page's message was not taken FOR NOW (the documented rate-limit codes and the Page's own send slots,
 * Meta's documented "temporarily unavailable"): read from the Graph error code, never from Meta's words.
 */
const NOT_NOW: ReadonlySet<MetaFailure> = new Set<MetaFailure>(["rate_limited", "unavailable"])

@Injectable()
/**
 * The LIVE Meta customer send (Facebook Messenger and Instagram): the existing Page sender handed through the port. Its yes is an
 * acknowledged delivery. A refusal FOR NOW before any part went out (a rate limit, Meta temporarily unavailable) is the port's one
 * channel-neutral not-sent answer (`CHANNELS_SEND_UNAVAILABLE`); any other no (the Page is gone, the credential unreadable, Meta refused,
 * the 24-hour window closed, no answer, a refusal after some parts went out) an unknown outcome, as the engine always read it. The
 * registry reaches it only for a live account.
 */
export class MetaCustomerSendService implements CustomerSendPort {
    readonly provider = "meta"

    constructor(private readonly sender: MetaChannelSender) {}

    /** Sends the text through the Page of the account the conversation came in on. */
    async send(
        _account: ConnectionRecord,
        target: ChannelTarget,
        _userId: string | null,
        request: CustomerSendRequest,
    ): Promise<DeliveryResult> {
        const answer = await this.sender.deliver(target, request.text)
        if (answer === null) return UNKNOWN
        if (answer.ok) return DELIVERED
        if (NOT_NOW.has(answer.reason) && (answer.partsSent ?? 0) === 0)
            throw new ChannelsError({ code: ChannelsErrorCode.SendUnavailable, params: { reason: `meta_${answer.reason}` } })
        return UNKNOWN
    }
}
