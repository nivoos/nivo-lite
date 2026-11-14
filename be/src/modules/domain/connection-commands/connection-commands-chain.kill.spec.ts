import { Test } from "@nestjs/testing"
import { mock, mockEntityManager } from "@starci/jest-preset"
import { ChannelFrontDoorService } from "@modules/domain/agent-instances"
import { ChannelConnectionsService } from "@modules/domain/channel-connections"
import { ConnectionGrantsService } from "@modules/domain/connection-grants"
import { ConnectionLifecycleService } from "@modules/domain/connection-lifecycle"
import { ConnectionsService } from "@modules/domain/connections"
import { GoogleConnectionsService } from "@modules/domain/google-connections"
import { MetaConnectionsService } from "@modules/domain/meta-connections"
import { WebhookConnectionsService } from "@modules/domain/webhook-connections"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { ERRORS_SERVICE, type ErrorsService } from "@modules/platform/errors"
import type { ClaimedJob } from "@modules/platform/jobs"
import { effectProviders, keptEffects, killed, recordingOutbox } from "@tests/fixtures/builders/provider-connections.builder"
import { ConnectionCommandsService } from "./connection-commands.service"
import { ConnectionCommandEntity } from "./persistence/entities"

const CONNECTION_ID = "00000000-0000-0000-0000-000000000001"
const row: ConnectionCommandEntity = {
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
const job: ClaimedJob = { jobId: "job-1", kind: "connection.command", fencingToken: 1, currentStep: null, payload: { commandId: "command-1", workspaceId: "workspace-1" } }
const KEY = "job-1:command"
const connected = { connection: { id: CONNECTION_ID }, botUsername: "shop_bot", accountMasked: null, webhookRegistered: true }

const build = async () => {
    const em = mockEntityManager({ findOne: [ConnectionCommandEntity, row], update: [ConnectionCommandEntity, { affected: 1 }] })
    const channels = mock<ChannelConnectionsService>()
    const frontDoor = mock<ChannelFrontDoorService>()
    const ledger = keptEffects()
    const moduleRef = await Test.createTestingModule({
        providers: [
            ConnectionCommandsService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: em },
            { provide: ERRORS_SERVICE, useValue: mock<ErrorsService>() },
            { provide: ConnectionsService, useValue: mock<ConnectionsService>() },
            { provide: ConnectionGrantsService, useValue: mock<ConnectionGrantsService>() },
            { provide: ChannelConnectionsService, useValue: channels },
            { provide: WebhookConnectionsService, useValue: mock<WebhookConnectionsService>() },
            { provide: GoogleConnectionsService, useValue: mock<GoogleConnectionsService>() },
            { provide: MetaConnectionsService, useValue: mock<MetaConnectionsService>() },
            { provide: ConnectionLifecycleService, useValue: mock<ConnectionLifecycleService>() },
            { provide: ChannelFrontDoorService, useValue: frontDoor },
            ...effectProviders(ledger, recordingOutbox().outbox),
        ],
    }).compile()
    return { service: moduleRef.get(ConnectionCommandsService), em, channels, frontDoor, ledger }
}

describe("connection command chain: the job is run twice, the second run repeats no finished step and no settled effect", () => {
    it("a kill before the provider act: the intent is released, the second run makes the act once and writes the outcome once", async () => {
        const t = await build()
        t.channels.connectTelegram.mockResolvedValue(connected as never)
        t.ledger.failNext(KEY, killed())

        await expect(t.service.run("command-1", job)).rejects.toMatchObject({ code: "ECONNRESET" })
        expect(t.channels.connectTelegram).not.toHaveBeenCalled()
        expect(t.em.update).not.toHaveBeenCalled()

        await t.service.run("command-1", job)

        expect(t.channels.connectTelegram).toHaveBeenCalledTimes(1)
        expect(t.ledger.rows.get(KEY)).toMatchObject({ state: "done", acts: 1 })
        expect(t.em.update).toHaveBeenCalledTimes(1)
        expect(t.frontDoor.ensureForConnection).toHaveBeenCalledTimes(1)
    })

    it("a kill after the act and before its outcome reached the row: the act is repeatable, so the second run makes it again under the same key and writes the outcome once", async () => {
        const t = await build()
        t.channels.connectTelegram.mockResolvedValue(connected as never)
        t.em.update.mockRejectedValueOnce(killed())

        await expect(t.service.run("command-1", job)).rejects.toMatchObject({ code: "ECONNRESET" })
        await t.service.run("command-1", job)

        // Telegram's getMe / setWebhook give the same state when made again; the bot of this workspace is connected in its own row.
        expect(t.channels.connectTelegram).toHaveBeenCalledTimes(2)
        expect(t.ledger.keys()).toEqual([KEY])
        expect(t.em.update).toHaveBeenCalledTimes(2)
    })

    it("a command whose outcome was written is never made again", async () => {
        const t = await build()
        t.em.findOne.mockResolvedValue({ ...row, status: "done", outcome: { ok: true, value: true } })

        await t.service.run("command-1", job)

        expect(t.channels.connectTelegram).not.toHaveBeenCalled()
        expect(t.ledger.keys()).toEqual([])
    })
})
