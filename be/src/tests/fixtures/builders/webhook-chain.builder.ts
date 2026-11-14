import { Test } from "@nestjs/testing"
import { FakeClock, mock, mockEntityManager, recordingQueueOutbox } from "@starci/jest-preset"
import { ConnectionsService } from "@modules/domain/connections"
import type { ConnectionRecord } from "@modules/domain/connections"
import { WebhookEventsService } from "@modules/domain/webhook-connections/webhook-events.service"
import { WEBHOOK_CONNECTIONS_OPTIONS } from "@modules/domain/webhook-connections/webhook-connections.decorators"
import { WebhookSendRegistryService } from "@modules/domain/webhook-connections/webhook-send-registry.service"
import type { WebhookSendPort, WebhookSendResult } from "@modules/domain/webhook-connections/webhook-send.port"
import { CLOCK } from "@modules/platform/clock"
import { Secret } from "@modules/platform/config"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import type { ClaimedJob } from "@modules/platform/jobs"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { QUEUE_OUTBOX } from "@modules/platform/queue"
import { N8N_WEBHOOK_JOB, type N8nWebhookPayload } from "@modules/queues/n8n"
import { keptEffectsLedger } from "./kept-effects.builder"

/** The delivery the chain specs run: one event of one occurrence for one connection. */
export const DELIVERY: N8nWebhookPayload = {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    connectionId: "c1",
    deliveryId: "c1:decision.made:wi-1",
    event: "decision.made",
    data: { work_item_id: "wi-1" },
    occurredAtMs: Date.parse("2026-10-13T03:00:00.000Z"),
}

/** The claimed job a delivery runs under (a resume is `resumeCount` 1 and above). */
export const deliveryJob = (extra: Partial<ClaimedJob> = {}): ClaimedJob => ({
    jobId: "job-1",
    kind: N8N_WEBHOOK_JOB,
    fencingToken: 1,
    currentStep: null,
    payload: DELIVERY,
    ...extra,
})

/** The connection of the delivery: a connected webhook account that picked the event. */
export const webhookConnection = (overrides: Partial<ConnectionRecord> = {}): ConnectionRecord => ({
    id: "c1",
    workspaceId: "11111111-1111-4111-8111-111111111111",
    provider: "webhook",
    name: "n8n",
    meta: { host: "receiver.test", events: "decision.made" },
    status: "connected",
    lastError: null,
    environment: "live",
    sandbox: false,
    isDefault: false,
    lastEventAt: null,
    firstEvent: null,
    createdBy: "owner-1",
    createdAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
})

/**
 * The webhook delivery chain: the real service over a receiver the spec scripts (`answers` is what the next POSTs get, the last one
 * repeats; `posts` is what reached the receiver, with its `x-nivo-delivery` header), the semantics of the kept effects ledger and a
 * connection record the failure hook writes to.
 */
export const buildWebhookChain = async () => {
    const ledger = keptEffectsLedger()
    const posts: Array<Readonly<Record<string, string>>> = []
    const answers: Array<WebhookSendResult | Error> = [{ status: 200, failure: null, durationMs: 5 }]
    let at = 0
    const port: WebhookSendPort = {
        provider: "webhook",
        post: (_connection, request) => {
            posts.push(request.headers)
            const answer = answers[Math.min(at, answers.length - 1)]
            at += 1
            return answer instanceof Error || answer === undefined ? Promise.reject(answer) : Promise.resolve(answer)
        },
    }
    const registry = new WebhookSendRegistryService()
    registry.register({ live: port, sandbox: port })
    const connections = mock<ConnectionsService>()
    const record = { current: webhookConnection() }
    connections.find.mockImplementation(() => Promise.resolve(record.current))
    connections.patch.mockImplementation((_ws, _id, change) => {
        record.current = { ...record.current, ...change } as ConnectionRecord
        return Promise.resolve(undefined)
    })
    const moduleRef = await Test.createTestingModule({
        providers: [
            WebhookEventsService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: mockEntityManager() },
            { provide: CLOCK, useValue: new FakeClock(new Date("2026-10-13T03:00:00.000Z")) },
            { provide: LOGGER, useValue: mock<Logger>() },
            { provide: WEBHOOK_CONNECTIONS_OPTIONS, useValue: { signingSecret: new Secret("engine-secret") } },
            { provide: QUEUE_OUTBOX, useValue: recordingQueueOutbox() },
            { provide: ConnectionsService, useValue: connections },
            { provide: WebhookSendRegistryService, useValue: registry },
            ...ledger.providers,
        ],
    }).compile()
    return {
        service: moduleRef.get(WebhookEventsService),
        ledger,
        posts,
        connections,
        record,
        /** What the receiver answers to the next POSTs, in order (the last one repeats). */
        answers: (...next: Array<WebhookSendResult | Error>): void => {
            answers.splice(0, answers.length, ...next)
            at = 0
        },
    }
}
