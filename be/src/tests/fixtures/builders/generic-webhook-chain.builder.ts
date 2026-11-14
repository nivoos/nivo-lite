import { Test } from "@nestjs/testing"
import { fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { GenericWebhookJobService } from "@modules/domain/agent-inbound/generic-webhook-job.service"
import { InboundDoorService } from "@modules/domain/agent-inbound/inbound-door.service"
import { ConnectionsService } from "@modules/domain/connections"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { LOGGER, type Logger } from "@modules/platform/logging"
import { DELIVER_GENERIC_WEBHOOK_JOB, GENERIC_WEBHOOK_QUEUE, type GenericWebhookPayload } from "@modules/queues/generic-webhook"

/** The verified delivery every spec of the generic-webhook chain runs. */
export const WEBHOOK_DELIVERY: GenericWebhookPayload = {
    connectionId: "conn-1",
    deliveryId: "conn-1:evt-1",
    rawBody: '{"type":"invoice.paid","id":"evt-1","amount":120}',
    eventType: null,
    deliveryKey: null,
}

/** The processor of the delivery job as the feature composes it: one domain method, the runner judges every failure. */
export class WebhookProcessor extends FencedProcessor {
    override readonly queue = GENERIC_WEBHOOK_QUEUE
    override readonly definition: JobDefinition<GenericWebhookPayload> = DELIVER_GENERIC_WEBHOOK_JOB
    constructor(private readonly service: GenericWebhookJobService) {
        super()
    }
    async process(job: ClaimedJob): Promise<void> {
        await this.service.run(job)
    }
}

/**
 * The real job service over a fake transaction and a door that, like the real one, wakes an agent once per idempotency key: `wakes`
 * holds the keys that were woken.
 */
export const webhookChain = async () => {
    const wakes = new Set<string>()
    const tx = fakeTransaction(mockEntityManager())
    const door = mock<InboundDoorService>()
    door.accept.mockImplementation((_tx, event) => {
        const fresh = !wakes.has(event.idempotencyKey)
        wakes.add(event.idempotencyKey)
        return Promise.resolve({ accepted: fresh, agentIds: fresh ? ["agent-1"] : [] }) as ReturnType<InboundDoorService["accept"]>
    })
    const connections = mock<ConnectionsService>()
    connections.intakeOf.mockResolvedValue({ kind: "ok", value: { id: "conn-1", workspaceId: "ws-9", status: "connected" } } as Awaited<ReturnType<ConnectionsService["intakeOf"]>>)
    const moduleRef = await Test.createTestingModule({
        providers: [
            GenericWebhookJobService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: tx.em },
            { provide: LOGGER, useValue: mock<Logger>() },
            { provide: ConnectionsService, useValue: connections },
            { provide: InboundDoorService, useValue: door },
        ],
    }).compile()
    return { processor: new WebhookProcessor(moduleRef.get(GenericWebhookJobService)), wakes, tx, door, connections }
}
