import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { ConnectionsService } from "@modules/domain/connections"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { payloadOfJob, type ClaimedJob } from "@modules/platform/jobs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { DELIVER_GENERIC_WEBHOOK_JOB } from "@modules/queues/generic-webhook"
import { AgentInboundLogEvent } from "./agent-inbound.log-events"
import { normalizeGenericWebhook } from "./generic-webhook.adapter"
import { InboundDoorService } from "./inbound-door.service"

/** The provider of a generic webhook endpoint's connection. */
const WEBHOOK_PROVIDER = "webhook"

@Injectable()
/**
 * The door of the generic-webhook job into the agents: the receipt of one verified delivery is read back, its endpoint's CONNECTION ROW names
 * the workspace, the delivery becomes the inbound event it is and goes to the door in one transaction. The job never reads the endpoint's
 * secret: the delivery was proven at the door (its signature, or a sandbox account's key) and a sandbox endpoint holds no secret. A
 * redelivered job finds its wake written already and writes nothing. An endpoint that is gone ends the job normally (logged).
 */
export class GenericWebhookJobService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectLogger() private readonly logger: Logger,
        private readonly connections: ConnectionsService,
        private readonly door: InboundDoorService,
    ) {}

    /**
     * Delivers the event the claimed job names (the runner already refused a payload the declaration does not accept). An endpoint that is
     * gone (removed or disconnected since the delivery was kept) is a typed end: it is logged and the job returns, there being nothing left
     * to wake. A failure throws and the job runner judges it.
     */
    async run(job: ClaimedJob): Promise<void> {
        const delivery = payloadOfJob(DELIVER_GENERIC_WEBHOOK_JOB, job)
        const endpoint = await this.connections.intakeOf(delivery.connectionId, WEBHOOK_PROVIDER)
        if (endpoint.kind !== "ok") {
            this.logger.warn(AgentInboundLogEvent.EndpointGone, { connectionId: delivery.connectionId, deliveryId: delivery.deliveryId })
            return
        }
        const event = normalizeGenericWebhook({
            workspaceId: endpoint.value.workspaceId,
            connectionId: delivery.connectionId,
            rawBody: Buffer.from(delivery.rawBody, "utf8"),
            eventType: delivery.eventType ?? undefined,
            deliveryKey: delivery.deliveryKey ?? undefined,
        })
        await this.entityManager.transaction((tx) => this.door.accept(tx, { ...event, idempotencyKey: delivery.deliveryId }))
    }
}
