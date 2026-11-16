import { Test } from "@nestjs/testing"
import type { EntityManager } from "typeorm"
import { FakeClock, mock } from "@starci/jest-preset"
import {
    AccountDataAdmissionsService,
    AccountDataIntakeService,
    AccountDataReadService,
    type AccountDataInput,
    type PendingRow,
} from "@modules/domain/account-data"
import { ZaloCredentialsService } from "@modules/domain/channels"
import { CustomerFilesService } from "@modules/domain/chat-files"
import { ConnectionsService } from "@modules/domain/connections"
import { PollLimiterService, PollReceiptsService, PollScheduleService, PollSchedulerService } from "@modules/domain/connection-poll"
import { CONNECTION_POLL_OPTIONS, POLL_RANDOM, type PollRandom } from "@modules/domain/connection-poll/connection-poll.decorators"
import { PollOwnerNoticeService } from "@modules/domain/connection-poll/poll-owner-notice.service"
import { DEFAULT_POLL_SCHEDULE } from "@modules/domain/connection-poll/poll-schedule.policy"
import { InboundEventsService } from "@modules/domain/inbound-events"
import { PollReceiverRegistryService } from "@modules/domain/provider-registry"
import { ProviderTriggersService } from "@modules/domain/provider-triggers"
import { ZALO_DATA_TYPES, ZaloInboxService } from "@modules/domain/zalo-inbox"
import { ZaloPollReceiverService } from "@modules/domain/zalo-inbox/zalo-poll-receiver.service"
import { ZaloSandboxPollReceiverService } from "@modules/domain/zalo-inbox/zalo-sandbox-poll-receiver.service"
import { ZaloInboxPollerService, ZaloSandboxInboxPollerService, ZaloStaleJudgeService, type ZaloAccessTokens } from "@modules/domain/zalo-provider"
import { ZaloError, ZaloErrorCode, type ZaloChatMessage, type ZaloClient } from "@modules/integrations/zalo"
import { CLOCK } from "@modules/platform/clock"
import type { ClaimedJob } from "@modules/platform/jobs"
import type { MessageCatalog } from "@modules/platform/i18n"
import { LOGGER, type Logger } from "@modules/platform/logging"
import type { QueueOutbox } from "@modules/platform/queue"
import { pollScheduleRowOf } from "@tests/fixtures/builders/connection-poll.builder"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { sandboxServiceOf } from "@tests/fixtures/builders/provider-sandbox.builder"

// THE PROOF WORLD OF A CUSTOMER LINE ON ONE EVENT WITH TWO WAYS IN (owner R95: `via: ["webhook", "poll"]`). One Zalo message must become
// ONE row, ONE admission, ONE consumer job and ONE delivery to the engine, whichever way reaches it first and however they race.
//
// REAL: the engine's scheduler tick (`PollSchedulerService.tick`), its walk (`ConnectionPollRunService`), its generic store
// (`PollReceiptsService`), the admissions registry, Zalo's LIVE poll receiver and its reader (`ZaloInboxPollerService`), the Zalo webhook
// door's tail (`ZaloInboxService.acceptZaloDelivery`), the admission it registers, the consumer (`processRecordedDelivery`), the provider's
// pure translate (`ZALO_MESSAGE_TRIGGER`), Zalo's stale rule and the declared account_data types' keys.
// DOUBLED (in memory): Zalo's HTTP client (the OA's inbox), the access tokens, the account_data table (UNIQUE (type, connection, key), a
// `wakes` row pending until completed), the transaction, the queue outbox, the schedule table / limiter / owner notice of the scheduler,
// the connections store, the ONE delivery function (it records each hand-over: its once-key is the engine's, not proven here) and the
// customer files / inbound events / credentials the consumer reads.

const WS = "ws-1"
const A = "aaaaaaaa-1111-4111-8111-111111111111"
const B = "bbbbbbbb-2222-4222-8222-222222222222"
const NOW = new Date("2026-11-14T09:00:00.000Z")
const MINUTE = 60_000
const JOB: ClaimedJob = { jobId: "job-1", kind: "zalo-delivery", fencingToken: 1, currentStep: null, payload: {} }

/** The token each account's reader presents to Zalo: it tells the OA's inbox of the account. */
const TOKEN: Readonly<Record<string, string>> = { [A]: "token-a", [B]: "token-b" }

const RECORDS = [A, B].map((id) => connectionRecord({ id, workspaceId: WS, provider: "zalo_oa", meta: {} }))

/** One customer text of the OA's inbox, as Zalo lists it. */
const chat = (messageId: string, minutesAgo: number, text: string, userId = "user-1"): ZaloChatMessage => ({
    messageId,
    userId,
    userName: "Lan",
    fromUser: true,
    kind: "text",
    text,
    sentAt: NOW.getTime() - minutesAgo * MINUTE,
})

/** The body Zalo's webhook posts for a listed text. */
const webhookBodyOf = (message: ZaloChatMessage): Buffer =>
    Buffer.from(
        JSON.stringify({
            app_id: "app-1",
            event_name: "user_send_text",
            timestamp: String(message.sentAt),
            sender: { id: message.userId },
            message: { msg_id: message.messageId, text: message.text },
        }),
    )

/** A transaction double: its work runs at once on itself. */
const txManager = (): EntityManager => {
    const manager: EntityManager = mock<EntityManager>({
        transaction: ((run: (tx: EntityManager) => Promise<unknown>) => run(manager)) as EntityManager["transaction"],
    })
    return manager
}

interface KeptRow {
    readonly connectionId: string
    readonly type: string
    readonly key: string
    readonly value: Record<string, unknown>
}

/** The world: every double, the real pieces over them. */
const buildWorld = async () => {
    // Zalo's side: the newest-first messages of each account's OA, and the accounts whose reads fail.
    const inboxes = new Map<string, Array<ZaloChatMessage>>([
        [TOKEN[A] ?? "", []],
        [TOKEN[B] ?? "", []],
    ])
    const failing = new Set<string>()
    const zalo = mock<ZaloClient>()
    zalo.recentChats.mockImplementation((token, offset) => {
        if (failing.has(token)) return Promise.reject(new ZaloError({ code: ZaloErrorCode.Unavailable }))
        const newestOf = new Map<string, ZaloChatMessage>()
        for (const message of inboxes.get(token) ?? []) if (!newestOf.has(message.userId)) newestOf.set(message.userId, message)
        return Promise.resolve(offset === 0 ? [...newestOf.values()] : [])
    })
    zalo.conversation.mockImplementation((token, userId, offset) =>
        Promise.resolve(offset === 0 ? (inboxes.get(token) ?? []).filter((message) => message.userId === userId) : []),
    )
    const tokens = mock<ZaloAccessTokens>()
    tokens.tokenOf.mockImplementation((id) => Promise.resolve({ kind: "token", token: TOKEN[id] ?? "" }))
    tokens.failureOf.mockReturnValue(null)
    const readerLimiter = mock<PollLimiterService>()
    readerLimiter.pass.mockResolvedValue(undefined)

    // The account_data table: UNIQUE (type, connection, key); a `wakes` row stays pending until its consumer completes it.
    const kept: Array<KeptRow> = []
    const completed = new Set<string>()
    const keyOf = (type: string, value: Record<string, unknown>): string =>
        (ZALO_DATA_TYPES.find((one) => one.name === type)?.key ?? []).map((member) => String(value[member] ?? "")).join(":")
    const intake = mock<AccountDataIntakeService>({
        write: (_tx: EntityManager, connectionId: string, rows: ReadonlyArray<AccountDataInput>) => {
            if (!RECORDS.some((one) => one.id === connectionId)) return Promise.resolve({ owner: null, rows: [] })
            const written = rows.map((row) => {
                const value = Object.fromEntries(Object.entries(row.value))
                const key = keyOf(row.type, value)
                if (kept.some((one) => one.connectionId === connectionId && one.type === row.type && one.key === key)) {
                    return { type: row.type, key, id: "", isNew: false }
                }
                kept.push({ connectionId, type: row.type, key, value })
                return { type: row.type, key, id: `row-${kept.length}`, isNew: true }
            })
            return Promise.resolve({ owner: { provider: "zalo_oa", connectionId, workspaceId: WS }, rows: written })
        },
        lockPending: (_tx: EntityManager, type: string, connectionId: string, key: string) => {
            const row = kept.find((one) => one.connectionId === connectionId && one.type === type && one.key === key)
            if (row === undefined || completed.has(`${connectionId}:${key}`)) return Promise.resolve(null)
            const pending: PendingRow = {
                id: `${connectionId}:${key}`,
                type,
                key,
                owner: { provider: "zalo_oa", connectionId, workspaceId: WS },
                value: row.value as PendingRow["value"],
            }
            return Promise.resolve(pending)
        },
        complete: (_tx: EntityManager, pending: PendingRow) => {
            completed.add(pending.id)
            return Promise.resolve()
        },
    })
    const eventRows = (connectionId?: string): ReadonlyArray<KeptRow> =>
        kept.filter((one) => one.type === "zalo_oa.event" && (connectionId === undefined || one.connectionId === connectionId))

    // The queue outbox: every consumer job the admission queued.
    const queued: Array<{ readonly queue: string; readonly message: { readonly deliveryId: string }; readonly dedupeKey: string | undefined }> = []
    let everQueued = 0
    const outbox = mock<QueueOutbox>({
        write: (_tx: EntityManager, queue: string, message: object, options?: { readonly dedupeKey?: string }) => {
            everQueued += 1
            queued.push({ queue, message: message as { deliveryId: string }, dedupeKey: options?.dedupeKey })
            return Promise.resolve()
        },
    })

    // The ONE delivery function: every hand-over to the engine, in order.
    const delivered: Array<{ readonly connectionId: string; readonly eventId: string; readonly at: string | null }> = []
    const triggers = mock<ProviderTriggersService>()
    triggers.deliver.mockImplementation((params) => {
        for (const entry of params.events) {
            const data = entry.event.data as { at?: string | null }
            delivered.push({ connectionId: params.connectionId, eventId: entry.event.id, at: data.at ?? null })
        }
        return Promise.resolve({ status: "delivered", events: params.events.length, dropped: 0, woken: [], repeats: 0, untaken: 0, held: 0 })
    })

    const clock = new FakeClock(NOW.toISOString())
    const logger = mock<Logger>()
    const connections = mock<ConnectionsService>()
    connections.find.mockImplementation((_ws, id) => Promise.resolve(RECORDS.find((one) => one.id === id) ?? null))
    connections.get.mockImplementation((_ws, id) => Promise.resolve(RECORDS.find((one) => one.id === id) ?? connectionRecord()))
    connections.patch.mockResolvedValue(undefined)
    connections.markReceived.mockResolvedValue(undefined)
    connections.intakeOf.mockImplementation((id) =>
        Promise.resolve({ kind: "ok", value: { id, workspaceId: WS, status: "connected" } } as Awaited<ReturnType<ConnectionsService["intakeOf"]>>),
    )
    const credentials = mock<ZaloCredentialsService>()
    credentials.load.mockResolvedValue({
        kind: "ok",
        value: { secret: { appId: "app-1", appSecret: "s", oaSecret: "o" }, expiresAt: null, workspaceId: WS },
    })
    const files = mock<CustomerFilesService>()
    files.keep.mockResolvedValue([])
    const reads = mock<AccountDataReadService>()
    reads.get.mockResolvedValue(null)
    const catalog = mock<MessageCatalog>()
    catalog.get.mockReturnValue("Khach Zalo")

    // The REAL Zalo side: admission registered by the inbox service, the generic store over the one intake, the live receiver over its reader.
    const manager = txManager()
    const admissions = new AccountDataAdmissionsService()
    const judge = new ZaloStaleJudgeService({ ports: { tokens: class {} as never } })
    const inbox = new ZaloInboxService(
        manager,
        mock<InboundEventsService>(),
        outbox,
        intake,
        reads,
        clock,
        logger,
        connections,
        credentials,
        files,
        triggers,
        catalog,
        admissions,
        judge,
    )
    inbox.onModuleInit()
    const receipts = new PollReceiptsService(manager, intake, admissions)
    const live = new ZaloPollReceiverService(new ZaloInboxPollerService(zalo, tokens, readerLimiter))
    const sandbox = new ZaloSandboxPollReceiverService(new ZaloSandboxInboxPollerService(sandboxServiceOf().sandbox))
    const receivers = new PollReceiverRegistryService()
    receivers.register({ live, sandbox })

    // The REAL scheduler tick over a doubled schedule table, limiter and owner notice.
    const schedule = mock<PollScheduleService>()
    schedule.settle.mockResolvedValue(undefined)
    schedule.defer.mockResolvedValue(undefined)
    schedule.enroll.mockResolvedValue(undefined)
    const limiter = mock<PollLimiterService>()
    limiter.enter.mockResolvedValue({ release: jest.fn().mockResolvedValue(undefined) })
    limiter.pass.mockResolvedValue(undefined)
    const random = mock<PollRandom>()
    random.next.mockReturnValue(0.5)
    const moduleRef = await Test.createTestingModule({
        providers: [
            PollSchedulerService,
            { provide: CLOCK, useValue: clock },
            { provide: LOGGER, useValue: logger },
            { provide: POLL_RANDOM, useValue: random },
            { provide: CONNECTION_POLL_OPTIONS, useValue: { schedule: DEFAULT_POLL_SCHEDULE, redis: undefined } },
            { provide: ConnectionsService, useValue: connections },
            { provide: PollScheduleService, useValue: schedule },
            { provide: PollReceiverRegistryService, useValue: receivers },
            { provide: PollReceiptsService, useValue: receipts },
            { provide: PollLimiterService, useValue: limiter },
            { provide: PollOwnerNoticeService, useValue: mock<PollOwnerNoticeService>() },
        ],
    }).compile()
    const scheduler = moduleRef.get(PollSchedulerService)

    /** The accounts the next tick finds due. */
    const due = (...ids: ReadonlyArray<string>): void => {
        schedule.claimDue.mockResolvedValueOnce(
            ids.map((id) => ({ row: pollScheduleRowOf({ connectionId: id, workspaceId: WS, provider: "zalo_oa" }), dueAt: new Date(NOW.getTime() - 2000) })),
        )
    }
    /** Runs every consumer job the admission queued, in the order queued, once each. */
    const consume = async (): Promise<void> => {
        for (const { message } of queued.splice(0)) await inbox.processRecordedDelivery(message, JOB)
    }
    return {
        inboxes,
        failing,
        eventRows,
        queued,
        delivered,
        queuedEver: () => everQueued,
        inbox,
        scheduler,
        schedule,
        connections,
        due,
        consume,
        zalo,
    }
}

describe("Zalo customer line, one event with two ways in", () => {
    it("(a) a webhook never delivered: the poll keeps the row, one admission queues one consumer, it delivers once; the late webhook does nothing", async () => {
        const world = await buildWorld()
        const message = chat("m-1", 3, "Shop con hoa khong?")
        world.inboxes.get(TOKEN[A] ?? "")?.push(message)
        world.due(A)

        const tallies = await world.scheduler.tick()

        expect(tallies.get("zalo_oa")).toMatchObject({ polled: 1, missedByWebhook: 1 })
        expect(world.eventRows(A)).toHaveLength(1)
        expect(world.eventRows(A)[0]).toMatchObject({ key: "m-1", value: { eventId: "m-1", source: "poll" } })
        expect(world.queued).toHaveLength(1)
        expect(world.queued[0]?.message).toEqual({ deliveryId: `${A}:m-1` })
        expect(world.delivered).toHaveLength(0)

        await world.consume()

        expect(world.delivered).toEqual([{ connectionId: A, eventId: "m-1", at: new Date(message.sentAt).toISOString() }])
        // The webhook finally arrives (a retry, a slow network): the row is kept, so nothing is queued and nothing is delivered again.
        await world.inbox.acceptZaloDelivery(webhookBodyOf(message), A, "proven")
        await world.consume()

        expect(world.eventRows(A)).toHaveLength(1)
        expect(world.queued).toHaveLength(0)
        expect(world.delivered).toHaveLength(1)
        // The cursor moved only after the whole walk was kept: the next tick has nothing new to admit.
        world.due(A)
        await world.scheduler.tick()
        expect(world.queued).toHaveLength(0)
    })

    it("(b) the webhook first, then the poll: one row, one consumer, one delivery", async () => {
        const world = await buildWorld()
        const message = chat("m-2", 2, "Cho minh dat 2 bo")
        world.inboxes.get(TOKEN[A] ?? "")?.push(message)

        await world.inbox.acceptZaloDelivery(webhookBodyOf(message), A, "proven")
        world.due(A)
        const tallies = await world.scheduler.tick()
        await world.consume()

        expect(tallies.get("zalo_oa")).toMatchObject({ found: 1, missedByWebhook: 0 })
        expect(world.eventRows(A)).toHaveLength(1)
        expect(world.eventRows(A)[0]?.value).not.toHaveProperty("source")
        expect(world.delivered.map((one) => one.eventId)).toEqual(["m-2"])
        expect(world.queuedEver()).toBe(1)
    })

    it("(b) the poll first, then the webhook: the same single row, consumer and delivery", async () => {
        const world = await buildWorld()
        const message = chat("m-3", 2, "Giao truoc 5h nhe")
        world.inboxes.get(TOKEN[A] ?? "")?.push(message)

        world.due(A)
        await world.scheduler.tick()
        await world.inbox.acceptZaloDelivery(webhookBodyOf(message), A, "proven")
        await world.consume()

        expect(world.eventRows(A)).toHaveLength(1)
        expect(world.delivered.map((one) => one.eventId)).toEqual(["m-3"])
        expect(world.queuedEver()).toBe(1)
    })

    it("(b) the webhook and the poll at the same moment (concurrent): one row, one consumer, one delivery", async () => {
        const world = await buildWorld()
        const message = chat("m-4", 1, "Ok")
        world.inboxes.get(TOKEN[A] ?? "")?.push(message)
        world.due(A)

        await Promise.all([world.inbox.acceptZaloDelivery(webhookBodyOf(message), A, "proven"), world.scheduler.tick()])
        await world.consume()

        expect(world.eventRows(A)).toHaveLength(1)
        expect(world.queued).toHaveLength(0)
        expect(world.delivered.map((one) => one.eventId)).toEqual(["m-4"])
    })

    it("(c) two lines listed newest first in one page: kept and admitted oldest first, handed on oldest first", async () => {
        const world = await buildWorld()
        // Zalo lists the conversation newest first: m-6 (1 min ago) then m-5 (4 min ago).
        world.inboxes.get(TOKEN[A] ?? "")?.push(chat("m-6", 1, "Co size M khong?"), chat("m-5", 4, "Chao shop"))
        world.due(A)

        await world.scheduler.tick()

        expect(world.eventRows(A).map((one) => one.key)).toEqual(["m-5", "m-6"])
        expect(world.queued.map((one) => one.message.deliveryId)).toEqual([`${A}:m-5`, `${A}:m-6`])
        expect(new Set(world.queued.map((one) => one.dedupeKey)).size).toBe(2)

        await world.consume()

        expect(world.delivered.map((one) => one.eventId)).toEqual(["m-5", "m-6"])
        const times = world.delivered.map((one) => Date.parse(one.at ?? ""))
        expect(times[0]).toBeLessThan(times[1] ?? 0)
    })

    it("(d) a failing read of one account is its own typed failure and plan; the next account of the same tick is still polled and admitted", async () => {
        const world = await buildWorld()
        world.inboxes.get(TOKEN[B] ?? "")?.push(chat("m-7", 2, "Ban oi"))
        world.failing.add(TOKEN[A] ?? "")
        world.due(A, B)

        const tallies = await world.scheduler.tick()

        expect(tallies.get("zalo_oa")).toMatchObject({ polled: 2, transient: 1, missedByWebhook: 1 })
        // A: the scheduler planned its next poll from the failure (one failed poll, breaker still closed); B was settled as a success.
        const plans = new Map(world.schedule.settle.mock.calls.map((call) => [call[0], call[1]]))
        expect(plans.get(A)).toMatchObject({ failures: 1, breakerState: "closed", succeeded: false })
        expect(plans.get(B)).toMatchObject({ failures: 0, succeeded: true })
        expect(world.eventRows(A)).toHaveLength(0)
        expect(world.eventRows(B).map((one) => one.key)).toEqual(["m-7"])
        // The failed account's cursor did not move; the good one's did.
        const patched = world.connections.patch.mock.calls.map((call) => call[1])
        expect(patched).toEqual([B])

        await world.consume()
        expect(world.delivered).toEqual([{ connectionId: B, eventId: "m-7", at: expect.any(String) }])
    })
})
