import { Test } from "@nestjs/testing"
import { builder, FakeClock, mock, mockEntityManager, recordingQueueOutbox } from "@starci/jest-preset"
import { ConnectionsService } from "@modules/domain/connections"
import type { ConnectionRecord } from "@modules/domain/connections"
import {
    WebhookDeliveryError,
    WebhookDeliveryErrorCode,
} from "@modules/integrations/webhook-delivery"
import type { WebhookDeliveryClient } from "@modules/integrations/webhook-delivery"
import { CLOCK } from "@modules/platform/clock"
import type { ClaimedJob } from "@modules/platform/jobs"
import { QueueError, QueueErrorCode } from "@modules/platform/queue"
import { Secret } from "@modules/platform/config"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { QUEUE_OUTBOX } from "@modules/platform/queue"
import { N8N_QUEUE, N8N_WEBHOOK_JOB } from "@modules/queues/n8n"
import type { N8nWebhookPayload } from "@modules/queues/n8n"
import type { ProviderSandboxService } from "@modules/domain/provider-sandbox"
import { keptEffectsLedger } from "@tests/fixtures/builders/kept-effects.builder"
import { sandboxAccount, sandboxServiceOf } from "@tests/fixtures/builders/provider-sandbox.builder"
import { WebhookConnectionsError, WebhookConnectionsErrorCode } from "./errors/webhook-connections.error"
import { WEBHOOK_CONNECTIONS_OPTIONS } from "./webhook-connections.decorators"
import { WebhookConnectionsLogEvent } from "./webhook-connections.log-events"
import type { WebhookConnectionsOptions } from "./webhook-connections.options"
import { signDelivery, workspaceSigningSecret } from "./webhook-signing.policy"
import { WebhookEventsService } from "./webhook-events.service"
import { WebhookLiveSendService } from "./webhook-live-send.service"
import { WebhookSandboxSendService } from "./webhook-sandbox-send.service"
import { WebhookSendRegistryService } from "./webhook-send-registry.service"

const NOW = new Date("2026-10-13T03:00:00.000Z")
const TARGET = "https://receiver.test/hook"
const OPTIONS: WebhookConnectionsOptions = { signingSecret: new Secret("engine-secret") }
const SIGNING_OFF: WebhookConnectionsOptions = { signingSecret: undefined }
const DATA = { work_item_id: "wi-1", outcome: "approved" }
const JOB: N8nWebhookPayload = {
    workspaceId: "ws-1",
    connectionId: "c1",
    deliveryId: "c1:decision.made:wi-1:approved",
    event: "decision.made",
    data: DATA,
    occurredAtMs: NOW.getTime(),
}

/** The claimed job a delivery runs under: the effect key is `<jobId>:webhook.post`. */
const claimed = (payload: N8nWebhookPayload = JOB): ClaimedJob => ({ jobId: "job-1", kind: N8N_WEBHOOK_JOB, fencingToken: 1, currentStep: null, payload })

const PUBLICATION = {
    workspaceId: "ws-1",
    event: "decision.made",
    data: DATA,
    dedupe: "decision.made:wi-1:approved",
} as const

const record = (overrides: Partial<ConnectionRecord> = {}): ConnectionRecord => ({
    id: "c1",
    workspaceId: "ws-1",
    provider: "webhook",
    name: "n8n",
    meta: { host: "receiver.test", events: "decision.made,lead.created" },
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

/** The outgoing port as the app registers it: the live twin over the doubles of the spec, the sandbox twin over a memory store. */
const sendsOf = (
    connections: ConnectionsService,
    delivery: WebhookDeliveryClient,
    logger: Logger,
    sandbox: ProviderSandboxService,
): WebhookSendRegistryService => {
    const registry = new WebhookSendRegistryService()
    registry.register({
        live: new WebhookLiveSendService(connections, delivery, logger),
        sandbox: new WebhookSandboxSendService(sandbox),
    })
    return registry
}

/** The account of the sandbox webhook connection of the spec. */
const SANDBOX_ACCOUNT = sandboxAccount({ id: "sbx-c1", workspaceId: "ws-1", provider: "webhook" })

const build = async (options: WebhookConnectionsOptions = OPTIONS, ledger = keptEffectsLedger()) => {
    const settings = builder<WebhookConnectionsOptions>(OPTIONS)(options)
    const connections = mock<ConnectionsService>()
    connections.listByProvider.mockResolvedValue([
        record(),
        record({ id: "c2", meta: { events: "lead.created" } }),
        record({ id: "c3", status: "pending" }),
    ])
    connections.find.mockResolvedValue(record())
    connections.readSecret.mockResolvedValue({ plain: JSON.stringify({ url: TARGET }), webhookSecret: "s" })
    connections.publicOrigin.mockReturnValue("https://nivo.vn")
    connections.patch.mockResolvedValue(undefined)
    const delivery = mock<WebhookDeliveryClient>()
    delivery.resolveTarget.mockResolvedValue(new URL(TARGET))
    delivery.post.mockResolvedValue({ status: 200, failure: null, durationMs: 12 })
    const outbox = recordingQueueOutbox()
    const logger = mock<Logger>()
    const em = mockEntityManager()
    const { sandbox } = sandboxServiceOf(SANDBOX_ACCOUNT)
    const moduleRef = await Test.createTestingModule({
        providers: [
            WebhookEventsService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: em },
            { provide: CLOCK, useValue: new FakeClock(NOW) },
            { provide: LOGGER, useValue: logger },
            { provide: WEBHOOK_CONNECTIONS_OPTIONS, useValue: settings },
            { provide: QUEUE_OUTBOX, useValue: outbox },
            { provide: ConnectionsService, useValue: connections },
            { provide: WebhookSendRegistryService, useValue: sendsOf(connections, delivery, logger, sandbox) },
            ...ledger.providers,
        ],
    }).compile()
    return { service: moduleRef.get(WebhookEventsService), connections, delivery, outbox, logger, em, sandbox, ledger }
}

/** The service on a deployment without a signing key: every other collaborator is an empty double. */
const buildWithoutSigning = async () => {
    const outbox = recordingQueueOutbox()
    const em = mockEntityManager()
    const logger = mock<Logger>()
    const delivery = mock<WebhookDeliveryClient>()
    const connections = mock<ConnectionsService>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            WebhookEventsService,
            { provide: WEBHOOK_CONNECTIONS_OPTIONS, useValue: SIGNING_OFF },
            { provide: QUEUE_OUTBOX, useValue: outbox },
            { provide: PRIMARY_ENTITY_MANAGER, useValue: em },
            { provide: CLOCK, useValue: new FakeClock(NOW) },
            { provide: LOGGER, useValue: logger },
            { provide: ConnectionsService, useValue: connections },
            { provide: WebhookSendRegistryService, useValue: sendsOf(connections, delivery, logger, sandboxServiceOf().sandbox) },
            ...keptEffectsLedger().providers,
        ],
    }).compile()
    return { service: moduleRef.get(WebhookEventsService), outbox }
}

describe("WebhookEventsService publish", () => {
    it("queues one delivery per connected webhook that picked the event, keyed by connection and occurrence", async () => {
        const { service, outbox } = await build()

        await expect(service.publish(PUBLICATION)).resolves.toBeUndefined()

        expect(outbox.jobs).toEqual([{ queue: N8N_QUEUE, payload: JOB }])
    })

    it("queues nothing while signing is off", async () => {
        const { service, outbox } = await buildWithoutSigning()

        await service.publish(PUBLICATION)

        expect(outbox.jobs).toEqual([])
    })

    it("uses the caller's manager and the occurrence's dedupe key for each subscription", async () => {
        const { service, connections, outbox } = await build()
        const manager = mockEntityManager()
        const write = jest.spyOn(outbox, "write")
        connections.listByProvider.mockResolvedValue([record(), record({ id: "c2" })])

        await service.publish(PUBLICATION, manager)

        expect(connections.listByProvider.mock.calls).toEqual([["ws-1", "webhook", { includeDisconnected: false }]])
        expect(write.mock.calls).toEqual([
            [manager, N8N_QUEUE, JOB, { job: N8N_WEBHOOK_JOB, dedupeKey: `${N8N_WEBHOOK_JOB}:${JOB.deliveryId}` }],
            [
                manager,
                N8N_QUEUE,
                { ...JOB, connectionId: "c2", deliveryId: `c2:${PUBLICATION.dedupe}` },
                { job: N8N_WEBHOOK_JOB, dedupeKey: `${N8N_WEBHOOK_JOB}:c2:${PUBLICATION.dedupe}` },
            ],
        ])
    })
})

describe("WebhookEventsService deliver", () => {
    it("posts the signed event with the delivery id and the occurrence timestamp", async () => {
        const { service, delivery } = await build()

        await expect(service.deliver(claimed())).resolves.toBeUndefined()

        const body = JSON.stringify({
            id: JOB.deliveryId,
            event: "decision.made",
            workspace_id: "ws-1",
            occurred_at: NOW.toISOString(),
            data: DATA,
        })
        const timestamp = String(NOW.getTime())
        const key = workspaceSigningSecret("engine-secret", "ws-1")
        expect(delivery.post.mock.calls).toEqual([
            [
                {
                    url: new URL(TARGET),
                    body,
                    headers: {
                        "x-nivo-event": "decision.made",
                        "x-nivo-delivery": JOB.deliveryId,
                        "x-nivo-timestamp": timestamp,
                        "x-nivo-signature": signDelivery(key, timestamp, body),
                    },
                },
            ],
        ])
    })

    it("throws a retryable failure when the receiver is down", async () => {
        const { service, delivery } = await build()
        delivery.post.mockResolvedValue({ status: null, failure: "timeout", durationMs: 10_000 })

        await expect(service.deliver(claimed())).rejects.toEqual(
            new WebhookConnectionsError({
                code: WebhookConnectionsErrorCode.ReceiverUnavailable,
                params: { status: "none" },
            }),
        )
    })

    it("throws a refusal of the input for a 4xx answer (a dead letter, no retry) and settles nothing on the ledger", async () => {
        const { service, delivery, connections, ledger } = await build()
        delivery.post.mockResolvedValue({ status: 410, failure: null, durationMs: 9 })

        await expect(service.deliver(claimed())).rejects.toEqual(
            new WebhookConnectionsError({ code: WebhookConnectionsErrorCode.ReceiverRefused, params: { status: "410" } }),
        )

        expect(connections.patch.mock.calls).toEqual([])
        expect(ledger.rows.has("job-1:webhook.post")).toBe(false)
    })

    it("throws the typed refusal of an address NIVO may not call and posts nothing", async () => {
        const { service, delivery, connections } = await build()
        delivery.resolveTarget.mockRejectedValue(
            new WebhookDeliveryError({ code: WebhookDeliveryErrorCode.TargetRefused }),
        )

        await expect(service.deliver(claimed())).rejects.toMatchObject({ code: WebhookConnectionsErrorCode.UrlRefused })

        expect(delivery.post.mock.calls).toEqual([])
        expect(connections.patch.mock.calls).toEqual([])
    })

    it("posts ONCE per job: the effect keeps the 2xx, so a run again posts nothing", async () => {
        const { service, delivery, ledger } = await build()

        await service.deliver(claimed())
        await service.deliver(claimed())

        expect(delivery.post).toHaveBeenCalledTimes(1)
        expect(ledger.rows.get("job-1:webhook.post")?.acts).toBe(1)
        expect(ledger.rows.get("job-1:webhook.post")?.kept).toBe(200)
    })

    it("throws typed config when the app composed no outgoing port for the provider", async () => {
        const { service, connections } = await build()
        connections.find.mockResolvedValue(record({ provider: "unknown" as never }))

        await expect(service.deliver(claimed())).rejects.toMatchObject({ code: WebhookConnectionsErrorCode.PortMissing })
    })
})

describe("WebhookEventsService deliveryFailed (the dead letter's hook)", () => {
    it("shows the reason on the connection so a person sees why the deliveries stopped", async () => {
        const { service, connections } = await build()
        const cause = new QueueError({ code: QueueErrorCode.FlowFailure, params: { failureClass: "input", reason: WebhookConnectionsErrorCode.ReceiverRefused } })

        await service.deliveryFailed(JOB, cause)

        expect(connections.patch.mock.calls).toEqual([["ws-1", "c1", { lastError: WebhookConnectionsErrorCode.ReceiverRefused }]])
    })

    it("has nothing to show for a payload that is no delivery or a cause with no reason", async () => {
        const { service, connections } = await build()

        await service.deliveryFailed({ connectionId: "c1" }, new Error("x"))
        await service.deliveryFailed(JOB, new Error("x"))

        expect(connections.patch).not.toHaveBeenCalled()
    })
})

describe("WebhookEventsService deliver", () => {
    it("drops the delivery of a connection that was switched off", async () => {
        const { service, delivery, connections } = await build()
        connections.find.mockResolvedValue(record({ status: "disconnected" }))

        await expect(service.deliver(claimed())).resolves.toBeUndefined()

        expect(delivery.post.mock.calls).toEqual([])
    })

    it("ignores a payload that is not a webhook delivery", async () => {
        const { service, connections, delivery, logger } = await build()

        await expect(service.deliver({ ...claimed(), payload: { connectionId: "c1" } })).resolves.toBeUndefined()

        expect(connections.find.mock.calls).toEqual([])
        expect(delivery.post.mock.calls).toEqual([])
        expect(logger.warn.mock.calls).toEqual([])
    })

    it("drops a delivery whose connection no longer exists", async () => {
        const { service, connections, delivery, logger } = await build()
        connections.find.mockResolvedValue(null)

        await expect(service.deliver(claimed())).resolves.toBeUndefined()

        expect(connections.find.mock.calls).toEqual([["ws-1", "c1"]])
        expect(connections.readSecret.mock.calls).toEqual([])
        expect(delivery.post.mock.calls).toEqual([])
        expect(logger.warn.mock.calls).toEqual([[WebhookConnectionsLogEvent.DeliveryDropped, { connectionId: "c1" }]])
    })

    it("drops a queued delivery when signing has been turned off", async () => {
        const { service, connections, delivery, logger } = await build(SIGNING_OFF)

        await expect(service.deliver(claimed())).resolves.toBeUndefined()

        // The address is not even read: with no signing key nothing could be signed, so the port is never asked.
        expect(connections.readSecret).not.toHaveBeenCalled()
        expect(delivery.resolveTarget.mock.calls).toEqual([])
        expect(logger.warn.mock.calls).toEqual([[WebhookConnectionsLogEvent.DeliveryDropped, { connectionId: "c1" }]])
    })

    it("throws the typed no-address refusal for a connection whose stored secret is missing (a dead letter, nothing swallowed)", async () => {
        const { service, connections, delivery, logger } = await build()
        connections.readSecret.mockResolvedValue(null)

        await expect(service.deliver(claimed())).rejects.toMatchObject({ code: WebhookConnectionsErrorCode.NoUrl })

        expect(delivery.resolveTarget.mock.calls).toEqual([])
        expect(logger.warn.mock.calls).toEqual([])
    })
})

describe("WebhookEventsService deliver", () => {
    it.each(["null", "42", "{}", '{"url":42}', '{"url":""}'])(
        "throws the typed no-address refusal for a secret without a nonempty URL: %s",
        async (plain) => {
            const { service, connections, delivery, logger } = await build()
            connections.readSecret.mockResolvedValue({ plain, webhookSecret: "s" })

            await expect(service.deliver(claimed())).rejects.toMatchObject({ code: WebhookConnectionsErrorCode.NoUrl })

            expect(delivery.resolveTarget.mock.calls).toEqual([])
            expect(logger.warn.mock.calls).toEqual([])
            expect(logger.error.mock.calls).toEqual([])
        },
    )

    it("records unreadable JSON in the log and throws the typed no-address refusal", async () => {
        const { service, connections, delivery, logger } = await build()
        connections.readSecret.mockResolvedValue({ plain: "broken JSON", webhookSecret: "s" })

        await expect(service.deliver(claimed())).rejects.toMatchObject({ code: WebhookConnectionsErrorCode.NoUrl })

        expect(delivery.post.mock.calls).toEqual([])
        expect(logger.error.mock.calls).toEqual([
            [WebhookConnectionsLogEvent.AddressUnreadable, expect.any(SyntaxError), { connectionId: "c1" }],
        ])
    })

    it("resolves the target without requiring a public origin on a local deployment", async () => {
        const { service, connections, delivery } = await build()
        connections.publicOrigin.mockReturnValue(null)

        await expect(service.deliver(claimed())).resolves.toBeUndefined()

        expect(delivery.resolveTarget.mock.calls).toEqual([[TARGET, false]])
        expect(delivery.post).toHaveBeenCalledTimes(1)
    })

    it("propagates an unexpected target resolution failure for a queue retry", async () => {
        const { service, connections, delivery, logger } = await build()
        const failure = new TypeError("resolver failure")
        delivery.resolveTarget.mockRejectedValue(failure)

        await expect(service.deliver(claimed())).rejects.toBe(failure)

        expect(delivery.post.mock.calls).toEqual([])
        expect(connections.patch.mock.calls).toEqual([])
        expect(logger.warn.mock.calls).toEqual([])
    })

    it.each([429, 503])("throws a retryable failure for HTTP %s", async (status) => {
        const { service, connections, delivery } = await build()
        delivery.post.mockResolvedValue({ status, failure: null, durationMs: 12 })

        await expect(service.deliver(claimed())).rejects.toEqual(
            new WebhookConnectionsError({
                code: WebhookConnectionsErrorCode.ReceiverUnavailable,
                params: { status: String(status) },
            }),
        )

        expect(connections.patch.mock.calls).toEqual([])
    })
})

describe("WebhookEventsService deliver", () => {
    it("clears an earlier failure after the receiver accepts a delivery", async () => {
        const { service, connections } = await build()
        connections.find.mockResolvedValue(record({ lastError: "HTTP 410" }))

        await expect(service.deliver(claimed())).resolves.toBeUndefined()

        expect(connections.patch.mock.calls).toEqual([["ws-1", "c1", { lastError: null }]])
    })
})

describe("WebhookEventsService deliver to a SANDBOX webhook account (the outgoing port's one switch)", () => {
    const sandboxRecord = (): ConnectionRecord => record({ id: "sbx-c1", sandbox: true })

    it("answers from the sandbox's default case (HTTP 200), reads no address, reaches no delivery client and logs ONE deliver call", async () => {
        const { service, delivery, connections, sandbox } = await build()
        connections.find.mockResolvedValue(sandboxRecord())

        await expect(service.deliver(claimed({ ...JOB, connectionId: "sbx-c1" }))).resolves.toBeUndefined()

        expect(delivery.resolveTarget).not.toHaveBeenCalled()
        expect(delivery.post).not.toHaveBeenCalled()
        expect(connections.readSecret).not.toHaveBeenCalled()
        const calls = await sandbox.calls(SANDBOX_ACCOUNT, "deliver")
        expect(calls).toHaveLength(1)
        expect(calls[0]).toMatchObject({ key: JOB.deliveryId, result: { outcome: "answered", value: { status: 200 } } })
    })

    it("the account's picked case decides the verdict: 400 is refused input (a dead letter), 429 / 503 / no answer are transient", async () => {
        const { service, connections, sandbox } = await build()
        connections.find.mockResolvedValue(sandboxRecord())
        const job = { ...JOB, connectionId: "sbx-c1" }

        await sandbox.setNextCase(SANDBOX_ACCOUNT, "deliver", "WEBHOOK-8")
        await expect(service.deliver(claimed(job))).rejects.toEqual(
            new WebhookConnectionsError({ code: WebhookConnectionsErrorCode.ReceiverRefused, params: { status: "400" } }),
        )
        expect(connections.patch.mock.calls).toEqual([])
        for (const [caseId, status] of [["WEBHOOK-9", "429"], ["WEBHOOK-10", "503"], ["WEBHOOK-11", "none"], ["WEBHOOK-12", "none"]] as const) {
            await sandbox.setNextCase(SANDBOX_ACCOUNT, "deliver", caseId)
            await expect(service.deliver(claimed(job))).rejects.toEqual(
                new WebhookConnectionsError({ code: WebhookConnectionsErrorCode.ReceiverUnavailable, params: { status } }),
            )
        }
    })
})
