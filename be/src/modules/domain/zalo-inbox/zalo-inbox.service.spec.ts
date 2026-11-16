import { Test } from "@nestjs/testing"
import type { ClaimedJob } from "@modules/platform/jobs"
import { FakeClock, fakeTransaction, mock, mockEntityManager, recordingQueueOutbox } from "@starci/jest-preset"
import { isTransactionManager } from "@starci/jest-preset/entity-manager"
import { AccountDataAdmissionsService, AccountDataIntakeService, AccountDataReadService } from "@modules/domain/account-data"
import type { AccountWrite, AdmittedRow, PendingRow, StoredRow } from "@modules/domain/account-data"
import { ZaloCredentialsService } from "@modules/domain/channels"
import { CustomerFilesService } from "@modules/domain/chat-files"
import { ConnectionsService } from "@modules/domain/connections"
import { InboundEventsService } from "@modules/domain/inbound-events"
import { ProviderTriggersService, type DeliverResult } from "@modules/domain/provider-triggers"
import { ZALO_MESSAGE_TRIGGER, ZaloStaleJudgeService } from "@modules/domain/zalo-provider"
import {
    ZALO_CONNECTION as CONNECTION,
    ZALO_OWNER as owner,
    ZALO_TEXT_BODY,
    ZALO_TEXT_EVENT,
    zaloEventPendingOf,
} from "@tests/fixtures/builders/zalo-inbox.builder"
import { CLOCK } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { MESSAGE_CATALOG, type MessageCatalog } from "@modules/platform/i18n"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { QUEUE_OUTBOX } from "@modules/platform/queue"
import { ZaloInboxService } from "./zalo-inbox.service"
import { ZALO_DELIVERY_QUEUE } from "./zalo-inbox.contracts"

/** The delivery job the receipt runs under: its id keys the effects of the files the message carries. */
const JOB: ClaimedJob = { jobId: "job-1", kind: "zalo-delivery", fencingToken: 1, currentStep: null, payload: {} }

const body = Buffer.from(ZALO_TEXT_BODY)
const NOW = new Date("2026-11-12T08:00:00.000Z")

/** What the intake answers for one event row of the given key. */
const writtenOf = (key: string, isNew: boolean): AccountWrite => ({
    owner,
    rows: [{ type: "zalo_oa.event", key, id: isNew ? "row-1" : "", isNew }],
})

/** A stored person row of the account. */
const storedUser = (value: Readonly<Record<string, unknown>>): StoredRow => ({
    id: "user-row",
    type: "zalo_oa.user",
    typeVersion: 1,
    key: "user-1",
    value,
    occurredAt: NOW,
    processedAt: null,
})

/** What the ONE delivery answers: the event delivered, and taken by a registered graph unless `untaken`. */
const deliveredOf = (untaken = 0): DeliverResult => ({ status: "delivered", events: 1, dropped: 0, sameFact: 0, woken: [], repeats: 0, untaken, held: 0 })

const build = async (
    written: AccountWrite = writtenOf("m-1", true),
    pending: PendingRow | null = zaloEventPendingOf(),
    stored: StoredRow | null = null,
) => {
    const tx = fakeTransaction(mockEntityManager({}))
    const triggers = mock<ProviderTriggersService>()
    triggers.deliver.mockResolvedValue(deliveredOf())
    const connections = mock<ConnectionsService>()
    connections.intakeOf.mockResolvedValue({ kind: "ok", value: { workspaceId: "w-1" } } as Awaited<ReturnType<ConnectionsService["intakeOf"]>>)
    connections.markReceived.mockResolvedValue(undefined)
    const credentials = mock<ZaloCredentialsService>()
    credentials.load.mockResolvedValue({
        kind: "ok",
        value: { secret: { appId: "app-1", appSecret: "s", oaSecret: "o" }, expiresAt: null, workspaceId: "w-1" },
    })
    const files = mock<CustomerFilesService>()
    files.keep.mockResolvedValue([])
    const catalog = mock<MessageCatalog>()
    catalog.get.mockReturnValue("Kh\u00e1ch Zalo")
    const intake = mock<AccountDataIntakeService>()
    intake.write.mockResolvedValue(written)
    intake.lockPending.mockResolvedValue(pending)
    intake.complete.mockResolvedValue(undefined)
    const reads = mock<AccountDataReadService>()
    reads.get.mockResolvedValue(stored)
    const inboundEvents = mock<InboundEventsService>()
    const logger = mock<Logger>()
    const outbox = recordingQueueOutbox()
    const write = jest.spyOn(outbox, "write")
    const judge = mock<ZaloStaleJudgeService>()
    judge.isStale.mockReturnValue(false)
    const moduleRef = await Test.createTestingModule({
        providers: [
            ZaloInboxService,
            AccountDataAdmissionsService,
            { provide: ZaloStaleJudgeService, useValue: judge },
            { provide: PRIMARY_ENTITY_MANAGER, useValue: tx.em },
            { provide: QUEUE_OUTBOX, useValue: outbox },
            { provide: ProviderTriggersService, useValue: triggers },
            { provide: ConnectionsService, useValue: connections },
            { provide: ZaloCredentialsService, useValue: credentials },
            { provide: CustomerFilesService, useValue: files },
            { provide: MESSAGE_CATALOG, useValue: catalog },
            { provide: InboundEventsService, useValue: inboundEvents },
            { provide: LOGGER, useValue: logger },
            { provide: AccountDataIntakeService, useValue: intake },
            { provide: AccountDataReadService, useValue: reads },
            { provide: CLOCK, useValue: new FakeClock(NOW) },
        ],
    }).compile()
    moduleRef.get(ZaloInboxService).onModuleInit()
    return {
        service: moduleRef.get(ZaloInboxService),
        admissions: moduleRef.get(AccountDataAdmissionsService),
        judge,
        tx,
        triggers,
        connections,
        credentials,
        files,
        outbox,
        write,
        intake,
        reads,
        inboundEvents,
        logger,
    }
}

describe("ZaloInboxService receipt delivery", () => {
    it("writes the first receipt as a zalo_oa.event row keyed by the message id and queues its consumer in the same transaction", async () => {
        const { service, triggers, write, intake, credentials } = await build()
        // A PROVEN delivery is queued whatever secret the account holds (a sandbox account holds none: E-FIX10).
        credentials.load.mockResolvedValue({ kind: "refused", code: "CHANNELS_CONNECTION_NOT_FOUND" } as Awaited<ReturnType<ZaloCredentialsService["load"]>>)
        await service.acceptZaloDelivery(body, CONNECTION, "proven")
        const manager = write.mock.calls[0]?.[0]
        expect(isTransactionManager(manager)).toBe(true)
        expect(intake.write).toHaveBeenCalledWith(manager, CONNECTION, [
            { type: "zalo_oa.event", value: { eventId: "m-1", event: "user_send_text", raw: ZALO_TEXT_EVENT } },
        ])
        expect(write).toHaveBeenCalledWith(
            manager,
            ZALO_DELIVERY_QUEUE,
            { deliveryId: `${CONNECTION}:m-1` },
            { job: "zalo-delivery", dedupeKey: `zalo-delivery:${CONNECTION}:m-1` },
        )
        expect(triggers.deliver).not.toHaveBeenCalled()
    })

    it("queues nothing for a redelivery: the row is not new", async () => {
        const { service, outbox, tx, intake } = await build(writtenOf("m-1", false))
        await service.acceptZaloDelivery(body, CONNECTION, "proven")
        expect(outbox.jobs).toEqual([])
        expect(intake.lockPending).not.toHaveBeenCalled()
        expect(tx.commits).toBe(1)
    })

    it("keeps nothing for a connection nobody holds, and logs it once", async () => {
        const { service, outbox, logger } = await build({ owner: null, rows: [] })
        await service.acceptZaloDelivery(body, CONNECTION, "proven")
        expect(outbox.jobs).toEqual([])
        expect(logger.warn).toHaveBeenCalledTimes(1)
        expect(logger.warn).toHaveBeenCalledWith("zalo_inbox.unknown_connection", { connectionId: CONNECTION })
    })

    it("writes nothing for a delivery without a body", async () => {
        const { service, intake, outbox } = await build()
        await service.acceptZaloDelivery(undefined, CONNECTION, "proven")
        expect(intake.write).not.toHaveBeenCalled()
        expect(outbox.jobs).toEqual([])
    })

    it("writes and completes at once an UNPROVEN delivery (the door's verdict), queueing nothing and reading no secret", async () => {
        const pending = zaloEventPendingOf()
        const { service, outbox, tx, triggers, intake, credentials } = await build(undefined, pending)
        await service.acceptZaloDelivery(body, CONNECTION, "unproven")
        expect(credentials.load).not.toHaveBeenCalled()
        expect(outbox.jobs).toEqual([])
        const manager = intake.write.mock.calls[0]?.[0]
        expect(intake.lockPending).toHaveBeenCalledWith(manager, "zalo_oa.event", CONNECTION, "m-1")
        expect(intake.complete).toHaveBeenCalledWith(manager, pending)
        expect(tx.commits).toBe(1)
        expect(triggers.deliver).not.toHaveBeenCalled()
    })

    it("writes a follow event under its own key and queues it", async () => {
        const { service, write, intake } = await build(writtenOf("follow:1700:user-9", true))
        const follow = { event_name: "follow", timestamp: "1700", follower: { id: "user-9" } }
        await service.acceptZaloDelivery(Buffer.from(JSON.stringify(follow)), CONNECTION, "proven")
        expect(intake.write.mock.calls[0]?.[2]).toEqual([
            { type: "zalo_oa.event", value: { eventId: "follow:1700:user-9", event: "follow", raw: follow } },
        ])
        expect(write).toHaveBeenCalledWith(
            expect.anything(),
            ZALO_DELIVERY_QUEUE,
            { deliveryId: `${CONNECTION}:follow:1700:user-9` },
            { job: "zalo-delivery", dedupeKey: `zalo-delivery:${CONNECTION}:follow:1700:user-9` },
        )
    })

    it("rolls back the row if publication fails", async () => {
        const { service, tx, outbox } = await build()
        const failure = new Error("publication failed")
        outbox.failNext("write", failure)
        await expect(service.acceptZaloDelivery(body, CONNECTION, "proven")).rejects.toBe(failure)
        expect(tx.rollbacks).toBe(1)
    })
})

describe("ZaloInboxService deferred effects", () => {
    it("hands the stored row's message to the ONE delivery as the provider translates it, then keeps the message and the person and completes, in one transaction", async () => {
        const raw = { ...ZALO_TEXT_EVENT, timestamp: "1762192200000" }
        const pending = zaloEventPendingOf(raw)
        const { service, tx, triggers, intake, connections } = await build(undefined, pending)
        await service.processRecordedDelivery({ deliveryId: `${CONNECTION}:m-1` }, JOB)
        const manager = triggers.deliver.mock.calls[0]?.[1]
        expect(isTransactionManager(manager)).toBe(true)
        expect(intake.lockPending).toHaveBeenCalledWith(manager, "zalo_oa.event", CONNECTION, "m-1")
        const at = new Date(1_762_192_200_000).toISOString()
        expect(triggers.deliver).toHaveBeenCalledTimes(1)
        expect(triggers.deliver).toHaveBeenCalledWith(
            {
                workspaceId: "w-1",
                declaration: ZALO_MESSAGE_TRIGGER,
                connectionId: CONNECTION,
                agentId: null,
                events: [
                    {
                        event: {
                            id: "m-1",
                            subject: { channel: "zalo", id: "user-1" },
                            data: { messageKey: "zalo:m-1", text: "Hello", at, attachments: [] },
                        },
                        raw: { type: "zalo_oa.event", id: "row-1" },
                        occurredAt: at,
                    },
                ],
            },
            manager,
        )
        expect(connections.markReceived).toHaveBeenCalledWith(
            CONNECTION,
            { amount: 0, content: "Kh\u00e1ch Zalo", at: NOW.toISOString(), text: "Hello" },
            manager,
        )
        expect(intake.write).toHaveBeenCalledWith(manager, CONNECTION, [
            { type: "zalo_oa.message", value: { msgId: "m-1", userId: "user-1", direction: "in", text: "Hello", at } },
            { type: "zalo_oa.user", value: { userId: "user-1", lastEvent: "user_send_text" } },
        ])
        expect(intake.complete).toHaveBeenCalledWith(manager, pending)
        expect(tx.commits).toBe(1)
    })

    it("delivers the same event id for a replay of the same row (the delivery keeps it to one wake)", async () => {
        const { service, triggers } = await build()
        await service.processRecordedDelivery({ deliveryId: `${CONNECTION}:m-1` }, JOB)
        await service.processRecordedDelivery({ deliveryId: `${CONNECTION}:m-1` }, JOB)
        const ids = triggers.deliver.mock.calls.map((call) => call[0].events.map((one) => one.event.id))
        expect(ids).toEqual([["m-1"], ["m-1"]])
    })

    it("keeps the pictures in the shop's store under the line's key before the delivery and hands them on as the event's files", async () => {
        const picture = {
            event_name: "user_send_image",
            sender: { id: "user-1" },
            message: { msg_id: "m-2", text: "ck roi", attachments: [{ type: "image", payload: { url: "https://cdn.test/a.jpg" } }] },
        }
        const kept = [{ id: "f-1", url: "https://files.test/f-1", name: "a.jpg", contentType: "image/jpeg" }]
        const { service, files, triggers } = await build(undefined, zaloEventPendingOf(picture, "m-2"))
        files.keep.mockResolvedValue(kept)
        await service.processRecordedDelivery({ deliveryId: `${CONNECTION}:m-2` }, JOB)
        expect(files.keep).toHaveBeenCalledWith(JOB, "w-1", "zalo:m-2", [
            { kind: "image", url: "https://cdn.test/a.jpg", thumbnailUrl: "", name: "", localPath: "" },
        ])
        expect(triggers.deliver.mock.calls[0]?.[0].events[0]).toMatchObject({ files: kept })
    })

    it("names the person as the poll's listing showed them, with no guest label", async () => {
        const polled = { event_name: "user_send_text", timestamp: "1762192200000", sender: { id: "user-1", display_name: "Lan" }, message: { msg_id: "m-1", text: "Hello" } }
        const { service, triggers, connections } = await build(undefined, zaloEventPendingOf(polled, "m-1", "poll"))
        await service.processRecordedDelivery({ deliveryId: `${CONNECTION}:m-1` }, JOB)
        expect(triggers.deliver.mock.calls[0]?.[0].events[0]?.event.subject).toEqual({ channel: "zalo", id: "user-1", name: "Lan" })
        expect(connections.markReceived.mock.calls[0]?.[1]).toMatchObject({ content: "Lan" })
    })

    it("keeps a message no registered graph took for the owner, as an unrouted channel message", async () => {
        const { service, triggers, inboundEvents } = await build()
        triggers.deliver.mockResolvedValue(deliveredOf(1))
        await service.processRecordedDelivery({ deliveryId: `${CONNECTION}:m-1` }, JOB)
        expect(inboundEvents.keepUnrouted).toHaveBeenCalledWith(expect.anything(), {
            workspaceId: "w-1",
            channel: "zalo",
            sender: "Kh\u00e1ch Zalo",
            body: "Hello",
            eventId: `zalo:${CONNECTION}:m-1`,
        })
    })

    it("delivers nothing for an event sent for another OA app, or of a connection that is no live Zalo one", async () => {
        const other = await build(undefined, zaloEventPendingOf({ ...ZALO_TEXT_EVENT, app_id: "app-2" }))
        await other.service.processRecordedDelivery({ deliveryId: `${CONNECTION}:m-1` }, JOB)
        expect(other.triggers.deliver).not.toHaveBeenCalled()
        expect(other.intake.complete).toHaveBeenCalledTimes(1)

        const gone = await build()
        gone.connections.intakeOf.mockResolvedValue({ kind: "refused", code: "x" } as unknown as Awaited<ReturnType<ConnectionsService["intakeOf"]>>)
        await gone.service.processRecordedDelivery({ deliveryId: `${CONNECTION}:m-1` }, JOB)
        expect(gone.triggers.deliver).not.toHaveBeenCalled()
    })

    it("keeps a person's name and follow state when a later message names neither", async () => {
        const { service, intake } = await build(undefined, undefined, storedUser({ userId: "user-1", name: "Lan", followed: true }))
        await service.processRecordedDelivery({ deliveryId: `${CONNECTION}:m-1` }, JOB)
        expect(intake.write.mock.calls[0]?.[2]).toContainEqual({
            type: "zalo_oa.user",
            value: { name: "Lan", followed: true, userId: "user-1", lastEvent: "user_send_text" },
        })
    })

    it("keeps the follow state of a person who follows the OA, delivering nothing", async () => {
        const follow = { event_name: "follow", timestamp: "1700", follower: { id: "user-9" } }
        const { service, triggers, intake } = await build(undefined, zaloEventPendingOf(follow, "follow:1700:user-9"))
        await service.processRecordedDelivery({ deliveryId: `${CONNECTION}:follow:1700:user-9` }, JOB)
        expect(triggers.deliver).not.toHaveBeenCalled()
        expect(intake.write).toHaveBeenCalledWith(expect.anything(), CONNECTION, [
            { type: "zalo_oa.user", value: { userId: "user-9", followed: true, lastEvent: "follow" } },
        ])
        expect(intake.complete).toHaveBeenCalledTimes(1)
    })
})

describe("ZaloInboxService deferred effects of events the chat does not answer", () => {
    it("lets an imported event name local files, and no webhook event", async () => {
        const image = {
            event_name: "user_send_image",
            sender: { id: "u" },
            message: { msg_id: "m", attachments: [{ type: "image", localPath: "/tmp/a.jpg", payload: {} }] },
        }
        const imported = await build(undefined, zaloEventPendingOf(image, "m", "manual_import"))
        await imported.service.processRecordedDelivery({ deliveryId: `${CONNECTION}:m` }, JOB)
        const webhook = await build(undefined, zaloEventPendingOf(image, "m"))
        await webhook.service.processRecordedDelivery({ deliveryId: `${CONNECTION}:m` }, JOB)
        expect(webhook.triggers.deliver).not.toHaveBeenCalled()
        expect(webhook.logger.info).toHaveBeenCalledWith(
            "zalo_inbox.event_ignored",
            expect.objectContaining({ eventName: "user_send_image" }),
        )
        expect(imported.triggers.deliver).toHaveBeenCalledTimes(1)
        expect(imported.logger.info).not.toHaveBeenCalledWith("zalo_inbox.event_ignored", expect.anything())
    })

    it("completes an event the chat does not answer without a delivery, and logs that it was dropped", async () => {
        const { service, triggers, intake, logger } = await build(undefined, zaloEventPendingOf({ text: "not json" }, "raw:x"))
        await service.processRecordedDelivery({ deliveryId: `${CONNECTION}:raw:x` }, JOB)
        expect(triggers.deliver).not.toHaveBeenCalled()
        expect(intake.write).not.toHaveBeenCalled()
        expect(intake.complete).toHaveBeenCalledTimes(1)
        expect(logger.info).toHaveBeenCalledWith("zalo_inbox.event_ignored", {
            connectionId: CONNECTION,
            eventName: "unreadable",
            reason: "not_answered",
        })
    })

    it("does nothing for an event that is absent or already completed, or a delivery id that names no connection", async () => {
        const { service, triggers, intake } = await build(undefined, null)
        await service.processRecordedDelivery({ deliveryId: `${CONNECTION}:m-1` }, JOB)
        await service.processRecordedDelivery({ deliveryId: "c-1:m-1" }, JOB)
        expect(intake.lockPending).toHaveBeenCalledTimes(1)
        expect(triggers.deliver).not.toHaveBeenCalled()
        expect(intake.complete).not.toHaveBeenCalled()
    })

    it("leaves the event pending and rethrows when the delivery fails", async () => {
        const { service, tx, triggers, intake } = await build()
        const failure = new Error("delivery failed")
        triggers.deliver.mockRejectedValue(failure)
        await expect(service.processRecordedDelivery({ deliveryId: `${CONNECTION}:m-1` }, JOB)).rejects.toBe(failure)
        expect(tx.rollbacks).toBe(1)
        expect(intake.complete).not.toHaveBeenCalled()
    })
})

describe("ZaloInboxService admission of a polled row", () => {
    const polled = {
        event_name: "user_send_text",
        timestamp: "1762192200000",
        sender: { id: "user-1", display_name: "Bui Nguyen Dinh" },
        message: { msg_id: "m-1", text: "Hello" },
    }
    const rowOf = (source: string | undefined, raw: object = polled): AdmittedRow => ({
        id: "row-1",
        type: "zalo_oa.event",
        key: "m-1",
        owner,
        value: { eventId: "m-1", event: "user_send_text", ...(source === undefined ? {} : { source }), raw },
    })

    it("is the one admission of the zalo_oa.event type, refusing a second", async () => {
        const { admissions, service } = await build()

        expect(admissions.has("zalo_oa.event")).toBe(true)
        expect(() => admissions.register("zalo_oa.event", () => Promise.resolve())).toThrow()
        expect(service).toBeDefined()
    })

    it("queues the consumer of a fresh polled message like a webhook delivery, keeping nothing for the owner", async () => {
        const { admissions, tx, write, inboundEvents, judge } = await build()

        await admissions.admit(tx.em, rowOf("poll"))

        expect(judge.isStale).toHaveBeenCalledWith(1_762_192_200_000, NOW.getTime())
        expect(write).toHaveBeenCalledWith(
            expect.anything(),
            ZALO_DELIVERY_QUEUE,
            { deliveryId: `${CONNECTION}:m-1` },
            { job: "zalo-delivery", dedupeKey: `zalo-delivery:${CONNECTION}:m-1` },
        )
        expect(inboundEvents.keepForOwner).not.toHaveBeenCalled()
    })

    it("completes a polled message too old to answer at once, keeps it for the owner and the account, and queues no answer", async () => {
        const pending = zaloEventPendingOf(polled, "m-1", "poll")
        const { admissions, tx, outbox, inboundEvents, intake, judge } = await build(undefined, pending)
        judge.isStale.mockReturnValue(true)

        await admissions.admit(tx.em, rowOf("poll"))

        expect(outbox.jobs).toEqual([])
        expect(intake.complete).toHaveBeenCalledWith(expect.anything(), pending)
        expect(inboundEvents.keepForOwner).toHaveBeenCalledWith(expect.anything(), {
            workspaceId: "w-1",
            channel: "zalo",
            sender: "Bui Nguyen Dinh",
            body: "Hello",
            eventId: `zalo:${CONNECTION}:m-1`,
        })
        expect(intake.write.mock.calls[0]?.[2]).toContainEqual({
            type: "zalo_oa.user",
            value: { userId: "user-1", name: "Bui Nguyen Dinh", lastEvent: "user_send_text" },
        })
    })

    it("judges no age for a row the webhook kept: it is queued whatever the judge would say", async () => {
        const { admissions, tx, outbox, judge } = await build()
        judge.isStale.mockReturnValue(true)

        await admissions.admit(tx.em, rowOf(undefined))

        expect(judge.isStale).not.toHaveBeenCalled()
        expect(outbox.jobs).toHaveLength(1)
    })
})

describe("ZaloInboxService two doors, one key", () => {
    it("lets whichever of the webhook and the poll comes first keep the message: the second row is not new, so it is never admitted", async () => {
        const { service, intake, outbox } = await build()
        intake.write.mockResolvedValueOnce(writtenOf("m-1", true)).mockResolvedValueOnce(writtenOf("m-1", false))

        await service.acceptZaloDelivery(body, CONNECTION, "proven")
        await service.acceptZaloDelivery(body, CONNECTION, "proven")

        expect(outbox.jobs).toHaveLength(1)
    })
})
