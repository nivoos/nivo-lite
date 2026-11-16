import { Test } from "@nestjs/testing"
import { FakeClock, mock } from "@starci/jest-preset"
import { ConnectionsService } from "@modules/domain/connections"
import { PollLimiterService, PollReceiptsService, PollScheduleService, PollSchedulerService } from "@modules/domain/connection-poll"
import { CONNECTION_POLL_OPTIONS, POLL_LIMITER_STORE, POLL_RANDOM, type PollRandom } from "@modules/domain/connection-poll/connection-poll.decorators"
import { ConnectionPollLogEvent } from "@modules/domain/connection-poll/connection-poll.log-events"
import { MemoryPollLimiterStore } from "@modules/domain/connection-poll/memory-poll-limiter.adapter"
import { PollOwnerNoticeService } from "@modules/domain/connection-poll/poll-owner-notice.service"
import type { PollScheduleRow } from "@modules/domain/connection-poll/poll-schedule.contracts"
import { DEFAULT_POLL_SCHEDULE } from "@modules/domain/connection-poll/poll-schedule.policy"
import { PollReceiverRegistryService } from "@modules/domain/provider-registry"
import { ZaloPollReceiverService } from "@modules/domain/zalo-inbox/zalo-poll-receiver.service"
import { ZaloSandboxPollReceiverService } from "@modules/domain/zalo-inbox/zalo-sandbox-poll-receiver.service"
import { ZaloInboxPollerService, ZaloSandboxInboxPollerService, type ZaloAccessTokens } from "@modules/domain/zalo-provider"
import type { ZaloChatMessage, ZaloClient } from "@modules/integrations/zalo"
import { CLOCK } from "@modules/platform/clock"
import { InboundEventsService } from "@modules/domain/inbound-events"
import { POLL_RATE_DEFERRED_REASON } from "@modules/domain/connection-poll/messages/connection-poll.messages"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database/primary.decorators"
import type { EntityManager } from "typeorm"
import { LOGGER, type Logger } from "@modules/platform/logging"
import { TIMER, type Timer } from "@modules/platform/retry"
import { pollScheduleRowOf } from "@tests/fixtures/builders/connection-poll.builder"
import { connectionRecord } from "@tests/fixtures/builders/connection-records.builder"
import { sandboxServiceOf } from "@tests/fixtures/builders/provider-sandbox.builder"

// THE PROOF WORLD OF A POLL THE PROVIDER'S RATE LIMIT HOLDS BACK (found on dev: a live Zalo OA was `CONNECTION_POLL_DEFERRED` on every tick,
// logged as an error, and never ran). The general rule, in engine words: a poll that waits for the provider's rate limit is PACED, then runs;
// a deferral (a window too long to wait inside the poll) is planned again after its window, counted, and is information, never a failure; a
// poll that cannot run cycle after cycle becomes ONE owner item through the poll's own owner door (`PollOwnerNoticeService`).
//
// REAL: the scheduler tick (`PollSchedulerService.tick`), its walk, the limiter (`PollLimiterService` over the in-memory bucket store), the
// plan after a deferral, Zalo's live poll receiver and its reader (which spends one call per list and per conversation, as on dev).
// DOUBLED (in memory): Zalo's HTTP client, the access tokens, the schedule TABLE (a row is claimed only when its `next_poll_at` has come, as the
// SQL does), the generic store (it records what the walk handed it), the connections store, the timer (it moves the fake clock), the owner's inbound-events door.

const WS = "ws-1"
const A = "aaaaaaaa-1111-4111-8111-111111111111"
const NOW = new Date("2026-11-14T09:00:00.000Z")
const MINUTE = 60_000
const TOKEN = "token-a"

/** One customer text of the OA's inbox, as Zalo lists it. */
const chat = (messageId: string, minutesAgo: number, userId: string): ZaloChatMessage => ({
    messageId,
    userId,
    userName: "Khach",
    fromUser: true,
    kind: "text",
    text: `line ${messageId}`,
    sentAt: NOW.getTime() - minutesAgo * MINUTE,
})

/** The in-memory bucket store of the limiter that refuses the FIRST `refusals` takes of the poll with a long window, then answers as a bucket. */
class ClosedGateStore extends MemoryPollLimiterStore {
    constructor(
        private refusals: number,
        private readonly windowMs: number,
    ) {
        super()
    }

    override take(key: string, limits: Parameters<MemoryPollLimiterStore["take"]>[1], now: number): ReturnType<MemoryPollLimiterStore["take"]> {
        if (this.refusals > 0) {
            this.refusals -= 1
            return Promise.resolve({ allowed: false, waitMs: this.windowMs })
        }
        return super.take(key, limits, now)
    }
}

interface WorldOptions {
    /** How many takes the gate refuses with a window too long to wait for (Infinity: it never opens). */
    readonly refusals?: number
    /** The window it names, in milliseconds. */
    readonly windowMs?: number
}

const buildWorld = async ({ refusals = 0, windowMs = 20_000 }: WorldOptions = {}) => {
    const clock = new FakeClock(NOW.toISOString())
    const inbox: Array<ZaloChatMessage> = []
    const zalo = mock<ZaloClient>()
    zalo.recentChats.mockImplementation((_token, offset) => {
        const newestOf = new Map<string, ZaloChatMessage>()
        for (const message of inbox) if (!newestOf.has(message.userId)) newestOf.set(message.userId, message)
        return Promise.resolve(offset === 0 ? [...newestOf.values()] : [])
    })
    zalo.conversation.mockImplementation((_token, userId, offset) =>
        Promise.resolve(offset === 0 ? inbox.filter((message) => message.userId === userId) : []),
    )
    const tokens = mock<ZaloAccessTokens>()
    tokens.tokenOf.mockResolvedValue({ kind: "token", token: TOKEN })
    tokens.failureOf.mockReturnValue(null)

    // The timer waits by moving the clock: a call that waits for a token finds the bucket refilled.
    const waits: Array<number> = []
    const timer = mock<Timer>()
    timer.schedule.mockImplementation((callback, delayMs) => {
        waits.push(delayMs)
        clock.advance(delayMs)
        callback()
        return () => undefined
    })

    const logger = mock<Logger>()
    // The REAL owner notice over a transaction double and the inbound-events door: every owner item it keeps is recorded.
    const manager: EntityManager = mock<EntityManager>({
        transaction: ((run: (tx: EntityManager) => Promise<unknown>) => run(manager)) as EntityManager["transaction"],
    })
    const ownerItems: Array<{ readonly eventId: string; readonly body: string }> = []
    const inboundEvents = mock<InboundEventsService>()
    inboundEvents.keepForOwner.mockImplementation((_tx, item) => {
        ownerItems.push({ eventId: item.eventId, body: item.body })
        return Promise.resolve(undefined as never)
    })
    const stored: Array<string> = []
    const receipts = mock<PollReceiptsService>()
    receipts.keep.mockImplementation((_connection, _type, rows) => {
        for (const row of rows) stored.push(String((row.value as { eventId?: string }).eventId))
        return Promise.resolve(rows.length)
    })
    const record = connectionRecord({ id: A, workspaceId: WS, provider: "zalo_oa", meta: {} })
    const connections = mock<ConnectionsService>()
    connections.find.mockResolvedValue(record)
    connections.get.mockResolvedValue(record)
    connections.patch.mockResolvedValue(undefined)

    // The schedule TABLE of one connection: claimed only once next_poll_at has come; a claim holds it for the lease; settle / defer write it.
    let nextPollAt = NOW.getTime() - 2000
    let row: PollScheduleRow = pollScheduleRowOf({ connectionId: A, workspaceId: WS, provider: "zalo_oa" })
    const schedule = mock<PollScheduleService>()
    schedule.enroll.mockResolvedValue(undefined)
    schedule.claimDue.mockImplementation(() => {
        if (nextPollAt > clock.now().getTime()) return Promise.resolve([])
        const dueAt = new Date(nextPollAt)
        nextPollAt = clock.now().getTime() + DEFAULT_POLL_SCHEDULE.leaseMs
        return Promise.resolve([{ row, dueAt }])
    })
    schedule.settle.mockImplementation((_id, plan) => {
        nextPollAt = plan.nextPollAt
        row = {
            ...row,
            intervalMs: plan.intervalMs,
            failures: plan.failures,
            breakerState: plan.breakerState,
            needsReauth: plan.needsReauth,
            backfillTo: plan.backfillTo === null ? null : new Date(plan.backfillTo),
            backfillNewest: plan.backfillNewest === null ? null : new Date(plan.backfillNewest),
        }
        return Promise.resolve(undefined)
    })
    schedule.defer.mockImplementation((_id, at) => {
        nextPollAt = at.getTime()
        return Promise.resolve(undefined)
    })

    const random = mock<PollRandom>()
    random.next.mockReturnValue(0.5)
    const moduleRef = await Test.createTestingModule({
        providers: [
            PollSchedulerService,
            PollLimiterService,
            { provide: POLL_LIMITER_STORE, useValue: new ClosedGateStore(refusals, windowMs) },
            { provide: CLOCK, useValue: clock },
            { provide: LOGGER, useValue: logger },
            { provide: TIMER, useValue: timer },
            { provide: POLL_RANDOM, useValue: random },
            { provide: CONNECTION_POLL_OPTIONS, useValue: { schedule: DEFAULT_POLL_SCHEDULE, redis: undefined } },
            { provide: ConnectionsService, useValue: connections },
            { provide: PollScheduleService, useValue: schedule },
            { provide: PollReceiptsService, useValue: receipts },
            PollOwnerNoticeService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: manager },
            { provide: InboundEventsService, useValue: inboundEvents },
            { provide: PollReceiverRegistryService, useValue: new PollReceiverRegistryService() },
        ],
    }).compile()
    const limiter = moduleRef.get(PollLimiterService)
    const receivers = moduleRef.get(PollReceiverRegistryService)
    receivers.register({
        live: new ZaloPollReceiverService(new ZaloInboxPollerService(zalo, tokens, limiter)),
        sandbox: new ZaloSandboxPollReceiverService(new ZaloSandboxInboxPollerService(sandboxServiceOf().sandbox)),
    })
    const scheduler = moduleRef.get(PollSchedulerService)
    return {
        clock,
        inbox,
        zalo,
        waits,
        logger,
        ownerItems,
        stored,
        scheduler,
        failuresOfRow: () => row.failures,
        nextPollAt: () => nextPollAt,
        /** One tick of the due job. */
        tick: () => scheduler.tick(),
        /** Moves the clock to the instant the connection is planned for. */
        toNextPoll: (): void => clock.set(nextPollAt),
    }
}

describe("a poll the provider's rate limit holds back", () => {
    it("(cause) a read that spends more calls than the burst holds is PACED by the limiter and runs: nothing is deferred, everything the OA answered is stored", async () => {
        const world = await buildWorld()
        // Four customers wrote: the walk spends 1 (page) + 1 (recent chats) + 4 (one conversation each) = 6 calls, the burst holds 4.
        world.inbox.push(chat("m-1", 1, "u-1"), chat("m-2", 2, "u-2"), chat("m-3", 3, "u-3"), chat("m-4", 4, "u-4"))

        const tallies = await world.tick()

        expect(tallies.get("zalo_oa")).toMatchObject({ polled: 1, deferred: 0, found: 4, missedByWebhook: 4 })
        expect(world.stored).toHaveLength(4)
        expect(world.waits.length).toBeGreaterThan(0)
        expect(world.waits.every((ms) => ms <= 5_000)).toBe(true)
        expect(world.failuresOfRow()).toBe(0)
        expect(world.logger.error).not.toHaveBeenCalled()
        expect(world.ownerItems).toHaveLength(0)
    })

    it("(a) deferred twice by a window too long to wait for, planned again after each window and never stacked, then it RUNS and stores what the provider answered", async () => {
        const world = await buildWorld({ refusals: 2, windowMs: 20_000 })
        world.inbox.push(chat("m-1", 1, "u-1"), chat("m-2", 2, "u-2"))

        const first = await world.tick()

        expect(first.get("zalo_oa")).toMatchObject({ deferred: 1, found: 0 })
        expect(world.nextPollAt()).toBe(NOW.getTime() + 20_000)
        expect(world.stored).toHaveLength(0)
        // A tick before the window has passed finds nothing due: no new attempt over the rescheduled one.
        world.clock.advance(5_000)
        expect((await world.tick()).size).toBe(0)

        world.toNextPoll()
        const second = await world.tick()

        expect(second.get("zalo_oa")).toMatchObject({ deferred: 1, found: 0 })
        expect(world.failuresOfRow()).toBe(2)

        world.toNextPoll()
        const third = await world.tick()

        expect(third.get("zalo_oa")).toMatchObject({ polled: 1, deferred: 0, found: 2, missedByWebhook: 2 })
        expect([...world.stored].sort()).toEqual(["m-1", "m-2"])
        expect(world.failuresOfRow()).toBe(0)
        // Information, never a failure: two `deferred` lines at info, no error line, nobody asked.
        const deferredLines = world.logger.info.mock.calls.filter((call) => call[0] === ConnectionPollLogEvent.Deferred)
        expect(deferredLines).toHaveLength(2)
        expect(deferredLines[1]?.[1]).toMatchObject({ waitMs: 20_000, cycles: 2 })
        expect(world.logger.error).not.toHaveBeenCalled()
        expect(world.ownerItems).toHaveLength(0)
    })

    it("(b) a poll that cannot run for the breaker threshold of cycles in a row becomes exactly ONE owner item, and the cycles past it write nothing", async () => {
        const world = await buildWorld({ refusals: Number.POSITIVE_INFINITY, windowMs: 20_000 })
        world.inbox.push(chat("m-1", 1, "u-1"))
        const threshold = DEFAULT_POLL_SCHEDULE.breakerThreshold

        await world.tick()
        for (let cycle = 2; cycle < threshold; cycle += 1) {
            world.toNextPoll()
            await world.tick()
        }
        expect(world.ownerItems).toHaveLength(0)

        world.toNextPoll()
        await world.tick()

        expect(world.failuresOfRow()).toBe(threshold)
        expect(world.ownerItems).toEqual([{ eventId: `unavailable:${A}:${world.clock.now().getTime()}`, body: POLL_RATE_DEFERRED_REASON }])

        for (let cycle = 0; cycle < 3; cycle += 1) {
            world.toNextPoll()
            await world.tick()
        }

        expect(world.ownerItems).toHaveLength(1)
        expect(world.stored).toHaveLength(0)
        expect(world.logger.error).not.toHaveBeenCalled()
    })
})
