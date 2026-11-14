import { Test } from "@nestjs/testing"
import { fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { ConnectionsService } from "@modules/domain/connections"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import type { ClaimedJob } from "@modules/platform/jobs"
import { LOGGER, type Logger } from "@modules/platform/logging"
import { AgentInboundLogEvent } from "./agent-inbound.log-events"
import { GenericWebhookJobService } from "./generic-webhook-job.service"
import { InboundDoorService } from "./inbound-door.service"

const JOB = {
    connectionId: "conn-1",
    deliveryId: "conn-1:evt-1",
    rawBody: '{"type":"invoice.paid","id":"evt-1","amount":120}',
    eventType: null,
    deliveryKey: null,
}

const claimed = (payload: object): ClaimedJob => ({ jobId: "job-1", kind: "generic-webhook.deliver", fencingToken: 1, currentStep: null, payload })

const build = async (endpoint: unknown = { kind: "ok", value: { id: "conn-1", workspaceId: "ws-9", status: "connected" } }) => {
    const tx = fakeTransaction(mockEntityManager())
    const door = mock<InboundDoorService>({
        accept: jest.fn().mockResolvedValue({ accepted: true, agentIds: ["agent-1"] }),
    })
    const connections = mock<ConnectionsService>({ intakeOf: jest.fn().mockResolvedValue(endpoint) })
    const logger = mock<Logger>()
    const container = await Test.createTestingModule({
        providers: [
            GenericWebhookJobService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: tx.em },
            { provide: LOGGER, useValue: logger },
            { provide: ConnectionsService, useValue: connections },
            { provide: InboundDoorService, useValue: door },
        ],
    }).compile()
    return { service: container.get(GenericWebhookJobService), tx, door, connections, logger }
}

describe("GenericWebhookJobService", () => {
    it("turns the receipt into the event of the endpoint workspace (read from its connection row, no secret) and hands it to the door in one transaction", async () => {
        const { service, tx, door, connections } = await build()

        await service.run(claimed(JOB))

        expect(connections.intakeOf).toHaveBeenCalledWith("conn-1", "webhook")
        expect(tx.em.transaction).toHaveBeenCalledTimes(1)
        expect(door.accept).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                adapter: "generic_webhook",
                workspaceId: "ws-9",
                eventType: "invoice.paid",
                payload: { type: "invoice.paid", id: "evt-1", amount: 120 },
                idempotencyKey: "conn-1:evt-1",
                agentId: null,
            }),
        )
    })

    it("keeps the delivery id the inbox claimed as the idempotency key, and the headers the sender named", async () => {
        const { service, door } = await build()

        await service.run(claimed({ ...JOB, deliveryId: "conn-1:hdr-9", eventType: "invoice.refunded", deliveryKey: "hdr-9" }))

        expect(door.accept).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ eventType: "invoice.refunded", idempotencyKey: "conn-1:hdr-9" }),
        )
    })

    it("refuses a payload that is no receipt as an input failure (the runner dead-letters it at once)", async () => {
        const { service, door } = await build()

        await expect(service.run(claimed({ nothing: true }))).rejects.toMatchObject({ params: { failureClass: "input" } })
        expect(door.accept).not.toHaveBeenCalled()
    })

    it("ends the job normally, logged, for an endpoint that is gone: nothing is left to wake", async () => {
        const { service, door, logger } = await build({ kind: "refused", code: "NOT_FOUND" })

        await expect(service.run(claimed(JOB))).resolves.toBeUndefined()

        expect(logger.warn).toHaveBeenCalledWith(AgentInboundLogEvent.EndpointGone, { connectionId: "conn-1", deliveryId: "conn-1:evt-1" })
        expect(door.accept).not.toHaveBeenCalled()
    })
})
