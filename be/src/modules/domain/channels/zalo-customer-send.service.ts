import { Injectable } from "@nestjs/common"
import type { ConnectionRecord } from "@modules/domain/connections"
import { InjectZalo, type ZaloClient } from "@modules/integrations/zalo"
import type { ChannelTarget, DeliveryResult, PersonMessage } from "./channels.contracts"
import type { CustomerSendPort, CustomerSendRequest } from "./customer-send-ports.contracts"
import { ChannelsError, ChannelsErrorCode } from "./errors/channels.error"
import { ZaloCredentialsService } from "./zalo-credentials.service"
import { ZaloDeliveryService } from "./zalo-delivery.service"

/**
 * Zalo's own refusals that say the OA is not taking the message FOR NOW, read from Zalo's typed error code (`zaloFailureOf`): the
 * account's quota and the night hours. Nothing went out, so a later try can.
 */
const NOT_NOW: ReadonlySet<string> = new Set(["zalo_quota", "zalo_night_hours"])

/** The word the port's not-sent answer carries for a token refresh another worker is making. */
const REFRESH_BUSY = "zalo_refresh_busy"

/** The port's one "nothing was sent, try later", with Zalo's own word for the log. */
const notSent = (reason: string): ChannelsError => new ChannelsError({ code: ChannelsErrorCode.SendUnavailable, params: { reason } })

@Injectable()
/**
 * The LIVE Zalo customer send: the existing Zalo route (the 48-hour window, ZNS fallback, QR image, token refresh) handed through the
 * port, with the person's name read from Zalo with the OA's token and the staff text sent through the OA. Its one translation is the
 * port's channel-neutral "nothing was sent, try later" (`CHANNELS_SEND_UNAVAILABLE`): Zalo's quota and night-hours refusals and a token
 * refresh another worker is making are thrown as that answer; everything else is the Zalo route's receipt unchanged. The registry
 * reaches it only for a live account.
 */
export class ZaloCustomerSendService implements CustomerSendPort {
    readonly provider = "zalo_oa"

    constructor(
        private readonly delivery: ZaloDeliveryService,
        private readonly credentials: ZaloCredentialsService,
        @InjectZalo() private readonly zalo: ZaloClient,
    ) {}

    /** Sends through the Zalo route; a refusal for now (quota, night hours, a busy token refresh) is the port's not-sent answer. */
    async send(
        _account: ConnectionRecord,
        target: ChannelTarget,
        userId: string | null,
        request: CustomerSendRequest,
    ): Promise<DeliveryResult> {
        let result: DeliveryResult
        try {
            result = await this.delivery.send(target, userId, request)
        } catch (cause) {
            if (cause instanceof ChannelsError && cause.code === ChannelsErrorCode.ZaloRefreshBusy) throw notSent(REFRESH_BUSY)
            throw cause
        }
        if (!result.delivered && result.outcome === "rejected" && result.failure !== null && NOT_NOW.has(result.failure))
            throw notSent(result.failure)
        return result
    }

    /** Sends one consultation text to a Zalo user through the OA (a rejected token is refreshed once); throws when it did not go out. */
    sendToPerson(_account: ConnectionRecord, request: PersonMessage): Promise<void> {
        return this.delivery.sendText(request.connectionId, request.recipientId, request.text)
    }

    /** The display name Zalo gives the customer, read with the OA's access token. */
    async nameOf(account: ConnectionRecord, personId: string): Promise<string> {
        const token = await this.credentials.accessToken(account.id)
        return this.zalo.userDisplayName(token, personId)
    }
}
