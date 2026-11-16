import { Test } from "@nestjs/testing"
import { SELF_DECLARED_DEPS_METADATA } from "@nestjs/common/constants"
import { mock, mockEntityManager } from "@starci/jest-preset"
import type { MockEntityManager } from "@starci/jest-preset"
import { ChannelFrontDoorService } from "@modules/domain/agent-instances"
import { ChannelConnectionsService } from "@modules/domain/channel-connections"
import { ConnectionGrantsService } from "@modules/domain/connection-grants"
import { ConnectionLifecycleService } from "@modules/domain/connection-lifecycle"
import { ConnectionsError, ConnectionsErrorCode, ConnectionsService } from "@modules/domain/connections"
import { GoogleConnectionsService } from "@modules/domain/google-connections"
import { MetaConnectionsService } from "@modules/domain/meta-connections"
import { WebhookConnectionsService } from "@modules/domain/webhook-connections"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import type { ClaimedJob } from "@modules/platform/jobs"
import type { ErrorsService } from "@modules/platform/errors"
import { ERRORS_SERVICE } from "@modules/platform/errors"
import { evaluatedCalls } from "@tests/fixtures/builders/evaluated-calls.builder"
import { effectProviders, keptEffects, recordingOutbox } from "@tests/fixtures/builders/provider-connections.builder"
import { ConnectionCommandsService } from "./connection-commands.service"
import { ConnectionCommandEntity } from "./persistence/entities"

const objectLike = (shape: Record<string, unknown>): unknown => expect.objectContaining(shape)
const itemsLike = (items: ReadonlyArray<unknown>): unknown => expect.arrayContaining(items)

const CONNECTION_ID = "00000000-0000-0000-0000-000000000001"
const row: ConnectionCommandEntity = {
    id: "command-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    kind: "connection.first-event",
    input: { connectionId: CONNECTION_ID },
    status: "pending",
    outcome: null,
    createdAt: new Date("2026-10-13T02:00:00.000Z"),
    finishedAt: null,
    updatedAt: new Date("2026-10-13T02:00:00.000Z"),
}
const actor = { principalId: "user-1", workspaceId: "workspace-1" }
const job = (extra: Partial<ClaimedJob> = {}): ClaimedJob => ({
    jobId: "job-1",
    kind: "connection.command",
    fencingToken: 1,
    currentStep: null,
    payload: { commandId: "command-1", workspaceId: "workspace-1" },
    ...extra,
})

const build = async (entityManager: MockEntityManager) => {
    const errors = mock<ErrorsService>()
    const connections = mock<ConnectionsService>()
    const grants = mock<ConnectionGrantsService>()
    const channels = mock<ChannelConnectionsService>()
    const webhooks = mock<WebhookConnectionsService>()
    const google = mock<GoogleConnectionsService>()
    const meta = mock<MetaConnectionsService>()
    const lifecycle = mock<ConnectionLifecycleService>()
    const frontDoor = mock<ChannelFrontDoorService>()
    const ledger = keptEffects()
    const moduleRef = await Test.createTestingModule({
        providers: [
            ConnectionCommandsService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: entityManager },
            { provide: ERRORS_SERVICE, useValue: errors },
            { provide: ConnectionsService, useValue: connections },
            { provide: ConnectionGrantsService, useValue: grants },
            { provide: ChannelConnectionsService, useValue: channels },
            { provide: WebhookConnectionsService, useValue: webhooks },
            { provide: GoogleConnectionsService, useValue: google },
            { provide: MetaConnectionsService, useValue: meta },
            { provide: ConnectionLifecycleService, useValue: lifecycle },
            { provide: ChannelFrontDoorService, useValue: frontDoor },
            ...effectProviders(ledger, recordingOutbox().outbox),
        ],
    }).compile()
    return { service: moduleRef.get(ConnectionCommandsService), errors, connections, meta, channels, frontDoor, grants, ledger }
}

describe("ConnectionCommandsService", () => {
    it("declares the platform errors service injection token", () => {
        const tokens: unknown = Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, ConnectionCommandsService)
        expect(tokens).toEqual(itemsLike([objectLike({ index: 1, param: ERRORS_SERVICE })]))
    })

    it("leaves an unknown command untouched", async () => {
        const entityManager = mockEntityManager({ findOne: [ConnectionCommandEntity, null] })
        const { service, connections, errors } = await build(entityManager)

        await expect(service.run("unknown-command", job())).resolves.toBeUndefined()

        expect(evaluatedCalls(entityManager.findOne.mock.calls)).toEqual([
            ["ConnectionCommandEntity", { where: { id: "unknown-command" } }],
        ])
        expect(connections.firstEvent).not.toHaveBeenCalled()
        expect(errors.describe).not.toHaveBeenCalled()
    })

    it("runs the command a claimed job payload names", async () => {
        const entityManager = mockEntityManager({ findOne: [ConnectionCommandEntity, null] })
        const { service } = await build(entityManager)

        await service.runFromJob(job({ payload: { commandId: "command-9", workspaceId: "workspace-1" } }))

        expect(evaluatedCalls(entityManager.findOne.mock.calls)).toEqual([
            ["ConnectionCommandEntity", { where: { id: "command-9" } }],
        ])
    })

    it("refuses a claimed job payload that names no command as an invalid input, touching nothing", async () => {
        const entityManager = mockEntityManager({ findOne: [ConnectionCommandEntity, null] })
        const { service } = await build(entityManager)

        await expect(service.runFromJob(job({ payload: { workspaceId: "workspace-1" } }))).rejects.toMatchObject({
            code: ConnectionsErrorCode.CommandInvalid,
        })

        expect(entityManager.findOne).not.toHaveBeenCalled()
    })

    it("does not run a command that is already done", async () => {
        const entityManager = mockEntityManager({ findOne: [ConnectionCommandEntity, { ...row, status: "done" }] })
        const { service, connections, errors } = await build(entityManager)

        await expect(service.run("command-1", job())).resolves.toBeUndefined()

        expect(evaluatedCalls(entityManager.findOne.mock.calls)).toEqual([
            ["ConnectionCommandEntity", { where: { id: "command-1" } }],
        ])
        expect(connections.firstEvent).not.toHaveBeenCalled()
        expect(errors.describe).not.toHaveBeenCalled()
    })
})

describe("ConnectionCommandsService", () => {
    it("runs a pending command as its member and writes its successful answer as JSON", async () => {
        const entityManager = mockEntityManager({
            findOne: [ConnectionCommandEntity, row],
            update: [ConnectionCommandEntity, { affected: 1 }],
        })
        const { service, connections, errors } = await build(entityManager)
        connections.firstEvent.mockResolvedValue({
            status: "connected",
            firstEvent: { amount: 75000, content: "invoice-7", at: "2026-10-13T02:00:00.000Z" },
        })

        await expect(service.run("command-1", job())).resolves.toBeUndefined()

        expect(connections.firstEvent.mock.calls).toEqual([[actor, CONNECTION_ID]])
        expect(evaluatedCalls(entityManager.update.mock.calls, 2)).toEqual([
            [
                "ConnectionCommandEntity",
                { id: "command-1", status: "pending" },
                {
                    status: "done",
                    outcome: {
                        ok: true,
                        value: {
                            status: "connected",
                            firstEvent: { amount: 75000, content: "invoice-7", at: "2026-10-13T02:00:00.000Z" },
                        },
                    },
                    finishedAt: "now()",
                },
            ],
        ])
        expect(errors.describe).not.toHaveBeenCalled()
    })

    it("describes a DomainError and writes exactly its kind, code and params as the failed outcome", async () => {
        const entityManager = mockEntityManager({
            findOne: [ConnectionCommandEntity, row],
            update: [ConnectionCommandEntity, { affected: 1 }],
        })
        const { service, connections, errors } = await build(entityManager)
        const error = new ConnectionsError({
            code: ConnectionsErrorCode.NotFound,
            params: { connectionId: CONNECTION_ID },
        })
        connections.firstEvent.mockRejectedValue(error)
        errors.describe.mockReturnValue({
            kind: "not-found",
            code: "CONNECTIONS_NOT_FOUND",
            params: { connectionId: CONNECTION_ID },
            status: 404,
        })

        await expect(service.run("command-1", job())).resolves.toBeUndefined()

        expect(connections.firstEvent.mock.calls).toEqual([[actor, CONNECTION_ID]])
        expect(errors.describe.mock.calls).toEqual([[error]])
        expect(evaluatedCalls(entityManager.update.mock.calls, 2)).toEqual([
            [
                "ConnectionCommandEntity",
                { id: "command-1", status: "pending" },
                {
                    status: "done",
                    outcome: {
                        ok: false,
                        kind: "not-found",
                        code: "CONNECTIONS_NOT_FOUND",
                        params: { connectionId: CONNECTION_ID },
                    },
                    finishedAt: "now()",
                },
            ],
        ])
    })
})

describe("ConnectionCommandsService failures and effects", () => {
    const pending = () =>
        mockEntityManager({
            findOne: [ConnectionCommandEntity, row],
            update: [ConnectionCommandEntity, { affected: 1 }],
        })
    const network = (): Error => Object.assign(new Error("connect ECONNRESET"), { code: "ECONNRESET" })

    it.each([
        ["the provider could not be reached", network()],
        ["a bug", new TypeError("x is not a function")],
    ])("throws %s for the runner and writes no outcome: a failure is not an answer", async (_name, failure) => {
        const entityManager = pending()
        const { service, connections, errors } = await build(entityManager)
        connections.firstEvent.mockRejectedValue(failure)

        await expect(service.run("command-1", job())).rejects.toBe(failure)

        expect(entityManager.update).not.toHaveBeenCalled()
        expect(errors.describe).not.toHaveBeenCalled()
    })

    it("makes the act of a command that reaches a provider as one effect keyed by the job, and keeps no answer on the ledger", async () => {
        const entityManager = pending()
        const { service, connections, ledger } = await build(entityManager)
        connections.firstEvent.mockResolvedValue({ status: "pending", firstEvent: null })

        await service.run("command-1", job())

        expect(ledger.keys()).toEqual(["job-1:command"])
        expect(ledger.rows.get("job-1:command")).toMatchObject({ state: "done", acts: 1, result: undefined })
    })

    it("runs a command that reaches no provider without the ledger", async () => {
        const entityManager = mockEntityManager({
            findOne: [
                ConnectionCommandEntity,
                {
                    ...row,
                    kind: "grant.set",
                    input: { connectionId: CONNECTION_ID, agentId: "00000000-0000-0000-0000-000000000002", bound: true },
                },
            ],
            update: [ConnectionCommandEntity, { affected: 1 }],
        })
        const { service, ledger, grants } = await build(entityManager)

        await service.run("command-1", job())

        expect(grants.setGrant).toHaveBeenCalledTimes(1)
        expect(ledger.keys()).toEqual([])
    })

    it("writes the stopped outcome on a pending command when the job reaches its dead letter, and ignores a payload that is not a command", async () => {
        const entityManager = pending()
        const { service } = await build(entityManager)

        await service.stopped({ commandId: "command-1", workspaceId: "workspace-1" })
        await service.stopped({ other: true })

        expect(evaluatedCalls(entityManager.update.mock.calls, 2)).toEqual([
            [
                "ConnectionCommandEntity",
                { id: "command-1", status: "pending" },
                {
                    status: "done",
                    outcome: { ok: false, kind: "unavailable", code: "CONNECTIONS_COMMAND_STOPPED", params: {} },
                    finishedAt: "now()",
                },
            ],
        ])
    })

    it("runs a command the dead letter closed as stopped again when a person resumed the job, and writes its answer over the stopped one", async () => {
        const stopped = {
            ...row,
            status: "done" as const,
            outcome: { ok: false, kind: "unavailable", code: "CONNECTIONS_COMMAND_STOPPED", params: {} },
        }
        const entityManager = mockEntityManager({
            findOne: [ConnectionCommandEntity, stopped],
            update: [ConnectionCommandEntity, { affected: 1 }],
        })
        const { service, connections } = await build(entityManager)
        connections.firstEvent.mockResolvedValue({ status: "pending", firstEvent: null })

        await service.run("command-1", job({ resumeCount: 1 }))

        expect(connections.firstEvent).toHaveBeenCalledTimes(1)
        expect(evaluatedCalls(entityManager.update.mock.calls, 2)).toEqual([
            [
                "ConnectionCommandEntity",
                { id: "command-1", status: "done" },
                { status: "done", outcome: { ok: true, value: { status: "pending", firstEvent: null } }, finishedAt: "now()" },
            ],
        ])
    })

    it("leaves a stopped command alone when the job runs again without a person's resume", async () => {
        const stopped = {
            ...row,
            status: "done" as const,
            outcome: { ok: false, kind: "unavailable", code: "CONNECTIONS_COMMAND_STOPPED", params: {} },
        }
        const entityManager = mockEntityManager({ findOne: [ConnectionCommandEntity, stopped] })
        const { service, connections } = await build(entityManager)

        await service.run("command-1", job())

        expect(connections.firstEvent).not.toHaveBeenCalled()
    })
})

describe("ConnectionCommandsService front door", () => {
    it("makes sure a channel has its front door when the first-event poll finds it connected with its first event", async () => {
        const entityManager = mockEntityManager({
            findOne: [ConnectionCommandEntity, row],
            update: [ConnectionCommandEntity, { affected: 1 }],
        })
        const { service, connections, frontDoor } = await build(entityManager)
        connections.firstEvent.mockResolvedValue({
            status: "connected",
            firstEvent: { amount: 0, content: "Khach", at: "2026-10-13T02:00:00.000Z" },
        })

        await service.run("command-1", job())

        expect(frontDoor.ensureForConnection.mock.calls).toEqual([[actor, CONNECTION_ID]])
    })

    it("leaves the front door alone while the connection is still waiting for its first event", async () => {
        const entityManager = mockEntityManager({
            findOne: [ConnectionCommandEntity, row],
            update: [ConnectionCommandEntity, { affected: 1 }],
        })
        const { service, connections, frontDoor } = await build(entityManager)
        connections.firstEvent.mockResolvedValue({ status: "pending", firstEvent: null })

        await service.run("command-1", job())

        expect(frontDoor.ensureForConnection).not.toHaveBeenCalled()
    })
})
