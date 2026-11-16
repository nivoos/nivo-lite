import { Injectable } from "@nestjs/common"
import { ChannelDeliveryService, ChannelsError, ChannelsErrorCode, RECIPIENT_NOT_LINKED } from "@modules/domain/channels"
import { ContactsService } from "@modules/domain/contacts"
import { ChannelDeliveriesService } from "@modules/domain/customer-routes"
import { EventsService } from "@modules/domain/events"
import { InjectClock, type Clock } from "@modules/platform/clock"
import type { ClaimedJob } from "@modules/platform/jobs"
import { QueueError } from "@modules/platform/queue"
import { isPublicMessageSendPayload } from "@modules/queues/public-api"
import { PublicApiError, PublicApiErrorCode } from "./errors/public-api.error"
import type { PendingMessageDelivery } from "./public-api.contracts"

/** The reason a delivery row keeps when the provider's own busy answer stopped the attempt before anything went out. */
const CHANNEL_BUSY = "channel_busy"

@Injectable()
/**
 * Sends an API message to the person of its route, as the send job the request's transaction wrote: one row of the engine's delivery
 * ledger claimed under the send key (`api.message:<request id>`) before the provider is asked and settled after, so the same request never
 * sends twice (a delivered key has nothing to do; only a definite refusal is tried again by the runner; an uncertain one is a dead
 * letter a person decides, and the person's resume sends it again). The person's id on the channel is read from the contact's own channel
 * identity; a person with none is a refusal row, not a send. No chat line is stored.
 */
export class PublicMessageDeliveryService {
    constructor(
        private readonly deliveries: ChannelDeliveriesService,
        private readonly channels: ChannelDeliveryService,
        private readonly contacts: ContactsService,
        private readonly events: EventsService,
        @InjectClock() private readonly clock: Clock,
    ) {}

    /**
     * The send job's one call: sends the reply the job carries (its payload was checked by the job's declaration), as a person's
     * decision to send an uncertain one again when the job is a resume.
     */
    async sendJob(job: ClaimedJob): Promise<void> {
        if (!isPublicMessageSendPayload(job.payload)) return
        await this.send(job.payload, (job.resumeCount ?? 0) > 0)
    }

    /**
     * Claims the send key and sends once. A provider that is not taking the message for now (`SendUnavailable`: busy, a rate, a window closed for the moment) is thrown (the claim
     * is released as refused first, so the runner's retry sends). A send an earlier try left uncertain is a typed dead letter; `resumed` (a person's resume of the parked job) is that
     * person deciding to send it again.
     */
    async send(pending: PendingMessageDelivery, resumed: boolean = false): Promise<void> {
        const { workspaceId, sendKey } = pending
        const claim = {
            sendKey,
            routeId: pending.routeId,
            contactId: pending.contactId,
            agentId: pending.agentId,
            runId: null,
            stepKey: null,
            text: pending.text,
            attachmentCount: 0,
            attachmentKinds: [],
            channel: pending.channel,
            accountId: pending.accountId,
        }
        let claimed = await this.deliveries.claim(workspaceId, claim, resumed)
        if (resumed && claimed.verdict === "unknown" && claimed.row.state === "claimed") {
            // An earlier start died with the send in flight and a person resumed the job: they decided it may go again.
            await this.deliveries.mark(workspaceId, sendKey, { state: "unknown", reason: null })
            claimed = await this.deliveries.claim(workspaceId, claim, true)
        }
        if (claimed.verdict === "delivered") return
        if (claimed.verdict === "unknown") {
            throw new PublicApiError({ code: PublicApiErrorCode.SendOutcomeUnknown, params: { sendKey } })
        }
        const userId = await this.userIdOf(pending)
        if (userId === null) {
            await this.deliveries.mark(workspaceId, sendKey, { state: "refused", reason: RECIPIENT_NOT_LINKED })
            return
        }
        const receipt = await this.channels
            .deliverToPerson({
                workspaceId,
                routeId: pending.routeId,
                channel: pending.channel,
                accountId: pending.accountId,
                userId,
                sendKey,
                text: pending.text,
            })
            .catch(async (cause: unknown) => {
                // The provider said it was busy before anything went out: the claim is released so the runner's retry can send.
                if (cause instanceof ChannelsError && cause.code === ChannelsErrorCode.SendUnavailable)
                    await this.deliveries.mark(workspaceId, sendKey, { state: "refused", reason: CHANNEL_BUSY })
                throw cause
            })
        if (receipt.delivered) {
            await this.deliveries.mark(workspaceId, sendKey, { state: "delivered", providerMessageId: null, at: this.clock.now() })
        } else if (receipt.outcome !== "rejected") {
            await this.deliveries.mark(workspaceId, sendKey, { state: "unknown", reason: null })
        } else {
            await this.deliveries.mark(workspaceId, sendKey, { state: "refused", reason: receipt.failure ?? "delivery_rejected" })
        }
    }

    /**
     * The send job was dead-lettered (one item for a person): the evidence log says the reply did not go out, so the API caller's
     * workspace sees it. The delivery row stays as it is (refused or uncertain) and a resume sends again.
     */
    async sendStopped(payload: object, cause: unknown): Promise<void> {
        if (!isPublicMessageSendPayload(payload)) return
        const reason = cause instanceof QueueError && typeof cause.params.reason === "string" ? cause.params.reason : "failed"
        await this.events.record({
            workspaceId: payload.workspaceId,
            kind: "api.message.stopped",
            actor: "NIVO",
            summary: "An API message did not go out; it waits for a person to run it again",
            evidence: `route=${payload.routeId} sendKey=${payload.sendKey} reason=${reason}`,
        })
    }

    /** The person's own id on the route's channel and account: the value of their channel identity there; null when they hold none. */
    private async userIdOf(pending: PendingMessageDelivery): Promise<string | null> {
        const person = await this.contacts.get(pending.workspaceId, pending.contactId)
        return (
            person?.identities.find(
                (identity) =>
                    identity.kind === "channel" && identity.provider === pending.channel && identity.account === (pending.accountId ?? ""),
            )?.value ?? null
        )
    }
}
