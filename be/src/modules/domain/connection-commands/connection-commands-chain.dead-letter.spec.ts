import { Test } from "@nestjs/testing"
import { mock, mockEntityManager } from "@starci/jest-preset"
import { ChannelFrontDoorService } from "@modules/domain/agent-instances"
import { ChannelConnectionsService } from "@modules/domain/channel-connections"
import { ConnectionGrantsService } from "@modules/domain/connection-grants"
import { ConnectionLifecycleService } from "@modules/domain/connection-lifecycle"
import { ConnectionsError, ConnectionsErrorCode, ConnectionsService } from "@modules/domain/connections"
import { GoogleConnectionsService } from "@modules/domain/google-connections"
import { MetaConnectionsService } from "@modules/domain/meta-connections"
import { WebhookConnectionsService } from "@modules/domain/webhook-connections"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { ERRORS_SERVICE, type ErrorsService } from "@modules/platform/errors"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import type { QueueDelivery } from "@modules/platform/queue"
import { RUN_CONNECTION_COMMAND_JOB, type ConnectionCommandPayload } from "@modules/queues/connection-commands"
import {
    buildRunner,
    deliveryOf,
    effectProviders,
    keptEffects,
    networkDown,
    recordingOutbox,
    startsOf,
} from "@tests/fixtures/builders/provider-connections.builder"
import { evaluatedCalls } from "@tests/fixtures/builders/evaluated-calls.builder"
import { ConnectionCommandsService } from "./connection-commands.service"
import { ConnectionCommandEntity } from "./persistence/entities"

/** The processor of the command job as the feature composes it: one domain method, the dead letter writes the stopped outcome. */
class CommandProcessor extends FencedProcessor {
    override readonly queue = "connection_commands"
    override readonly definition: JobDefinition<ConnectionCommandPayload> = RUN_CONNECTION_COMMAND_JOB
    constructor(private readonly commands: ConnectionCommandsService) {
        super()
    }
    async process(job: ClaimedJob): Promise<void> {
        await this.commands.runFromJob(job)
    }
    override async onFailed(delivery: QueueDelivery, _cause: unknown): Promise<void> {
        await this.commands.stopped(delivery.payload)
    }
}

const payload = { commandId: "command-1", workspaceId: "workspace-1" }
const delivery = (attempt: number) => deliveryOf("connection_commands", "connection.command", payload, attempt)
const pending: ConnectionCommandEntity = {
    id: "command-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    kind: "telegram.connect",
    input: { name: "Shop bot", token: "123456:abc-token" },
    status: "pending",
    outcome: null,
    createdAt: new Date("2026-10-13T02:00:00.000Z"),
    finishedAt: null,
    updatedAt: new Date("2026-10-13T02:00:00.000Z"),
}
const connected = { connection: { id: "00000000-0000-0000-0000-000000000001" }, botUsername: "shop_bot", accountMasked: null, webhookRegistered: true }

const build = async () => {
    const em = mockEntityManager({ findOne: [ConnectionCommandEntity, pending], update: [ConnectionCommandEntity, { affected: 1 }] })
    const channels = mock<ChannelConnectionsService>()
    const errors = mock<ErrorsService>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            ConnectionCommandsService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: em },
            { provide: ERRORS_SERVICE, useValue: errors },
            { provide: ConnectionsService, useValue: mock<ConnectionsService>() },
            { provide: ConnectionGrantsService, useValue: mock<ConnectionGrantsService>() },
            { provide: ChannelConnectionsService, useValue: channels },
            { provide: WebhookConnectionsService, useValue: mock<WebhookConnectionsService>() },
            { provide: GoogleConnectionsService, useValue: mock<GoogleConnectionsService>() },
            { provide: MetaConnectionsService, useValue: mock<MetaConnectionsService>() },
            { provide: ConnectionLifecycleService, useValue: mock<ConnectionLifecycleService>() },
            { provide: ChannelFrontDoorService, useValue: mock<ChannelFrontDoorService>() },
            ...effectProviders(keptEffects(), recordingOutbox().outbox),
        ],
    }).compile()
    return { service: moduleRef.get(ConnectionCommandsService), em, channels, errors }
}

describe("connection command chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes", () => {
    it("the provider unreachable: the waited ladder 1, 2, 4, 8 min, then one dead letter; the row reads stopped meanwhile; the resume runs the command and writes its answer", async () => {
        const t = await build()
        const run = await buildRunner()
        const processor = new CommandProcessor(t.service)
        t.channels.connectTelegram.mockRejectedValue(networkDown())
        run.claimed(payload)

        const seen = await startsOf(run.runner, processor, delivery, 5)

        expect(seen).toEqual([60, 120, 240, 480, "returned"])
        expect(t.channels.connectTelegram).toHaveBeenCalledTimes(5)
        expect(run.claims.park).toHaveBeenCalledTimes(1)
        expect(run.deadLetters.raise).toHaveBeenCalledTimes(1)
        // The retries wrote nothing to the row; the dead letter closed it as stopped, so the screen stops waiting.
        expect(evaluatedCalls(t.em.update.mock.calls, 2)).toEqual([
            [
                "ConnectionCommandEntity",
                { id: "command-1", status: "pending" },
                { status: "done", outcome: { ok: false, kind: "unavailable", code: "CONNECTIONS_COMMAND_STOPPED", params: {} }, finishedAt: "now()" },
            ],
        ])

        t.em.findOne.mockResolvedValue({
            ...pending,
            status: "done",
            outcome: { ok: false, kind: "unavailable", code: "CONNECTIONS_COMMAND_STOPPED", params: {} },
        })
        t.channels.connectTelegram.mockResolvedValue(connected as never)
        const resumed = await buildRunner(1)
        resumed.claimed(payload)
        await resumed.runner.run(processor, delivery(1))

        expect(t.channels.connectTelegram).toHaveBeenCalledTimes(6)
        expect(evaluatedCalls(t.em.update.mock.calls, 2)[1]).toEqual([
            "ConnectionCommandEntity",
            { id: "command-1", status: "done" },
            { status: "done", outcome: { ok: true, value: connected }, finishedAt: "now()" },
        ])
        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(resumed.deadLetters.raise).not.toHaveBeenCalled()
    })

    it("a refusal the input earned (a field that does not fit) is written as the failed answer and the job completes: nothing is parked and no item is raised", async () => {
        const t = await build()
        const run = await buildRunner()
        const processor = new CommandProcessor(t.service)
        const refusal = new ConnectionsError({ code: ConnectionsErrorCode.CommandInvalid, params: { field: "token" } })
        t.channels.connectTelegram.mockRejectedValue(refusal)
        t.errors.describe.mockReturnValue({ kind: "invalid", code: "CONNECTIONS_COMMAND_INVALID", params: {}, status: 400 })
        run.claimed(payload)

        await run.runner.run(processor, delivery(1))

        expect(t.channels.connectTelegram).toHaveBeenCalledTimes(1)
        expect(evaluatedCalls(t.em.update.mock.calls, 2)).toEqual([
            [
                "ConnectionCommandEntity",
                { id: "command-1", status: "pending" },
                { status: "done", outcome: { ok: false, kind: "invalid", code: "CONNECTIONS_COMMAND_INVALID", params: {} }, finishedAt: "now()" },
            ],
        ])
        expect(run.claims.complete).toHaveBeenCalledTimes(1)
        expect(run.claims.park).not.toHaveBeenCalled()
        expect(run.deadLetters.raise).not.toHaveBeenCalled()
    })

    it("a bug (not a refusal of the input) parks at once as code with one item, and the row reads stopped", async () => {
        const t = await build()
        const run = await buildRunner()
        const processor = new CommandProcessor(t.service)
        t.channels.connectTelegram.mockRejectedValue(new TypeError("x is not a function"))
        run.claimed(payload)

        await run.runner.run(processor, delivery(1))

        expect(run.claims.park.mock.calls[0]?.[0]).toMatchObject({ failureClass: "code" })
        expect(run.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(evaluatedCalls(t.em.update.mock.calls, 2)[0]?.[2]).toMatchObject({ outcome: { code: "CONNECTIONS_COMMAND_STOPPED" } })
    })
})
