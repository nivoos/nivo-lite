import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { ConnectionsService, type ConnectionRecord } from "@modules/domain/connections"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { InjectEffects, type Effects } from "@modules/platform/effects"
import type { ClaimedJob } from "@modules/platform/jobs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { InjectQueueOutbox, QueueError, type QueueOutbox } from "@modules/platform/queue"
import { eachInOrder } from "@modules/platform/primitives"
import {
    EMIT_WEBHOOK_JOB,
    N8N_QUEUE,
    N8N_WEBHOOK_JOB,
    WEBHOOK_POST_EFFECT,
    isN8nWebhookPayload,
    type N8nWebhookPayload,
} from "@modules/queues/n8n"
import { WebhookConnectionsError, WebhookConnectionsErrorCode } from "./errors/webhook-connections.error"
import type { WebhookPublication } from "./webhook-connections.contracts"
import { InjectWebhookConnectionsOptions } from "./webhook-connections.decorators"
import { WebhookConnectionsLogEvent } from "./webhook-connections.log-events"
import type { WebhookConnectionsOptions } from "./webhook-connections.options"
import { installedWebhookEvents } from "./webhook-events.catalogue"
import { WebhookSendRegistryService } from "./webhook-send-registry.service"
import type { WebhookSendPort, WebhookSendRequest } from "./webhook-send.port"
import { deliveryVerdict, eventsOf, signDelivery, workspaceSigningSecret } from "./webhook-signing.policy"

@Injectable()
/**
 * The business events leaving NIVO through the webhook connections: every connected webhook of the workspace that picked the event
 * gets one signed delivery job (once per connection and occurrence), and the job posts it with the per-workspace signing key and
 * the same headers and signature as the wizard's test, through the account's outgoing webhook port (`portFor`: the receiver of a live
 * account, the hardcoded cases of a sandbox one).
 */
export class WebhookEventsService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectClock() private readonly clock: Clock,
        @InjectLogger() private readonly logger: Logger,
        @InjectWebhookConnectionsOptions() private readonly options: WebhookConnectionsOptions,
        @InjectQueueOutbox() private readonly outbox: QueueOutbox,
        private readonly connections: ConnectionsService,
        private readonly sends: WebhookSendRegistryService,
        @InjectEffects() private readonly effects: Effects,
    ) {}

    /**
     * Queues the event for every connected webhook of the workspace that picked it, inside the caller's transaction when it hands
     * one. `dedupe` names the occurrence: publishing it twice queues nothing twice. Nothing is queued while signing is off.
     */
    async publish(publication: WebhookPublication, manager: EntityManager = this.entityManager): Promise<void> {
        if (this.options.signingSecret === undefined) return
        const { workspaceId, event, data, dedupe } = publication
        const available = installedWebhookEvents().map((option) => option.id)
        const subscribed = (
            await this.connections.listByProvider(workspaceId, "webhook", { includeDisconnected: false })
        ).filter((connection) => connection.status === "connected" && eventsOf(connection.meta, available).includes(event))
        const occurredAtMs = this.clock.now().getTime()
        await eachInOrder(subscribed, async (connection) => {
            const job: N8nWebhookPayload = {
                workspaceId,
                connectionId: connection.id,
                deliveryId: `${connection.id}:${dedupe}`,
                event,
                data,
                occurredAtMs,
            }
            await this.outbox.write(manager, N8N_QUEUE, job, {
                job: N8N_WEBHOOK_JOB,
                dedupeKey: EMIT_WEBHOOK_JOB.onceKey(job),
            })
        })
    }

    /**
     * The effect of one delivery job: posts the signed event to the connection's address, once per job (`<jobId>:webhook.post`). A
     * receiver that is down, slow or busy (no answer, 408, 429, 5xx) throws a transient failure (the runner retries it on the background
     * ladder, then parks it with one item); any other answer, an address NIVO may not call, or a connection with no address is refused
     * input (a dead letter at once: nothing is swallowed). Only a 2xx answer settles the effect; the receiver dedupes a delivery a lost
     * outcome posts again on the `x-nivo-delivery` header. A connection that is gone or off, or signing switched off, is a normal end.
     */
    async deliver(job: ClaimedJob): Promise<void> {
        const payload = job.payload
        if (!isN8nWebhookPayload(payload)) return
        const connection = await this.connections.find(payload.workspaceId, payload.connectionId)
        const shared = this.options.signingSecret
        if (connection?.status !== "connected" || shared === undefined) {
            this.logger.warn(WebhookConnectionsLogEvent.DeliveryDropped, { connectionId: payload.connectionId })
            return
        }
        const port = this.sends.portFor(connection)
        if (port === undefined) throw new WebhookConnectionsError({ code: WebhookConnectionsErrorCode.PortMissing })
        const body = JSON.stringify({
            id: payload.deliveryId,
            event: payload.event,
            workspace_id: payload.workspaceId,
            occurred_at: new Date(payload.occurredAtMs).toISOString(),
            data: payload.data,
        })
        const timestamp = String(payload.occurredAtMs)
        const key = workspaceSigningSecret(shared.reveal(), payload.workspaceId)
        const request: WebhookSendRequest = {
            body,
            headers: {
                "x-nivo-event": payload.event,
                "x-nivo-delivery": payload.deliveryId,
                "x-nivo-timestamp": timestamp,
                "x-nivo-signature": signDelivery(key, timestamp, body),
            },
        }
        await this.effects.once(`${job.jobId}:${WEBHOOK_POST_EFFECT.name}`, WEBHOOK_POST_EFFECT, {
            act: () => this.posted(port, connection, request),
            keep: (status) => status,
            from: (kept) => (typeof kept === "number" ? kept : 0),
        })
        if (connection.lastError !== null) {
            await this.connections.patch(connection.workspaceId, connection.id, { lastError: null })
        }
    }

    /**
     * The job was dead-lettered (one item for a person): the connection shows why its deliveries stopped (the failure's code); a resume
     * posts again and clears it. A payload that is no delivery, or a connection that is gone, has nothing to show.
     */
    async deliveryFailed(payload: object, cause: unknown): Promise<void> {
        if (!isN8nWebhookPayload(payload)) return
        const reason = cause instanceof QueueError && typeof cause.params.reason === "string" ? cause.params.reason : null
        if (reason === null) return
        await this.connections.patch(payload.workspaceId, payload.connectionId, { lastError: reason })
    }

    /**
     * Posts one signed delivery through the account's port and judges the receiver's answer: a 2xx answers its status (kept by the
     * effect); an answer a later try may change (no answer, 408, 429, 5xx) and any other answer are thrown, so the effect is released and
     * the runner decides.
     */
    private async posted(port: WebhookSendPort, connection: ConnectionRecord, request: WebhookSendRequest): Promise<number> {
        const result = await port.post(connection, request)
        const verdict = deliveryVerdict(result.status)
        const status = result.status === null ? "none" : String(result.status)
        if (verdict === "retry") {
            throw new WebhookConnectionsError({ code: WebhookConnectionsErrorCode.ReceiverUnavailable, params: { status } })
        }
        if (verdict === "refused") {
            throw new WebhookConnectionsError({ code: WebhookConnectionsErrorCode.ReceiverRefused, params: { status } })
        }
        return result.status ?? 0
    }
}
