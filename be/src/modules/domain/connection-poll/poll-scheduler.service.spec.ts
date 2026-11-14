import { Test } from "@nestjs/testing"
import { FakeClock, mock } from "@starci/jest-preset"
import { ConnectionsService } from "@modules/domain/connections"
import { CLOCK } from "@modules/platform/clock"
import {
    POLL_MINUTE_MS,
    POLL_NOW,
    POLL_NOW_MS,
    pollConnectionRecordOf,
    pollScheduleRowOf,
    readPollPageOf,
} from "@tests/fixtures/builders/connection-poll.builder"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { CONNECTION_POLL_OPTIONS, POLL_RANDOM } from "./connection-poll.decorators"
import type { PollRandom } from "./connection-poll.decorators"
import { PollReceiverRegistryService, type PollReceiver } from "@modules/domain/provider-registry"
import type { PollFailure } from "./connection-poll.contracts"
import { ConnectionPollLogEvent } from "./connection-poll.log-events"
import { POLL_CURSOR_KEY } from "./connection-poll.policy"
import { ConnectionPollError, ConnectionPollErrorCode } from "./errors/connection-poll.error"
import { PollLimiterService } from "./poll-limiter.service"
import { PollOwnerNoticeService } from "./poll-owner-notice.service"
import type { DueConnection } from "./poll-schedule.service"
import { PollScheduleService } from "./poll-schedule.service"
import { DEFAULT_POLL_SCHEDULE } from "./poll-schedule.policy"
import type { PollScheduleRow } from "./poll-schedule.contracts"
import { PollReceiptsService } from "./poll-receipts.service"
import { PollSchedulerService } from "./poll-scheduler.service"

const NOW = POLL_NOW
const NOW_MS = POLL_NOW_MS
const MIN = POLL_MINUTE_MS
const limits = { ratePerSecond: 2, burst: 2, concurrency: 1 }

const dueOf = (over: Partial<PollScheduleRow> = {}, lagMs = 2000): DueConnection => ({
    row: pollScheduleRowOf(over),
    dueAt: new Date(NOW_MS - lagMs),
})

/** The receiver of Sepay: dense (4 minutes) when poll is the only way, sparse (20 minutes) while its webhook delivers. */
const CADENCE = { aloneMs: 4 * MIN, besideWebhookMs: 20 * MIN }

/** A receiver of a provider: its read and its classification are the doubles the tests answer with. */
const receiverOf = (provider: string, dataType: string, classified: PollFailure): jest.Mocked<PollReceiver> => ({
    provider,
    dataType,
    limits,
    cadence: CADENCE,
    read: jest.fn().mockResolvedValue(readPollPageOf(2)),
    classify: jest.fn().mockReturnValue(classified),
})

interface BuildOptions {
    /** How the receiver classifies a failed read. */
    readonly classified?: PollFailure
    /** Registers nothing: no provider can be polled. */
    readonly empty?: boolean
}

const build = async ({ classified = { kind: "transient" }, empty = false }: BuildOptions = {}) => {
    const live = receiverOf("sepay", "sepay.transaction", classified)
    const sandbox = receiverOf("sepay", "sepay.transaction", classified)
    const imapLive = receiverOf("imap", "imap.mail", classified)
    const imapSandbox = receiverOf("imap", "imap.mail", classified)
    const receivers = new PollReceiverRegistryService()
    if (!empty) {
        receivers.register({ live, sandbox })
        receivers.register({ live: imapLive, sandbox: imapSandbox })
    }
    const receipts = mock<PollReceiptsService>()
    receipts.keep.mockResolvedValue(2)
    const random = mock<PollRandom>()
    random.next.mockReturnValue(0.5)
    const connections = mock<ConnectionsService>()
    connections.find.mockResolvedValue(pollConnectionRecordOf())
    connections.get.mockResolvedValue(pollConnectionRecordOf())
    connections.patch.mockResolvedValue(undefined)
    const schedule = mock<PollScheduleService>()
    schedule.claimDue.mockResolvedValue([])
    const limiter = mock<PollLimiterService>()
    limiter.enter.mockResolvedValue({ release: jest.fn().mockResolvedValue(undefined) })
    limiter.pass.mockResolvedValue(undefined)
    const notice = mock<PollOwnerNoticeService>()
    const logger = mock<Logger>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            PollSchedulerService,
            { provide: CLOCK, useValue: new FakeClock(NOW) },
            { provide: LOGGER, useValue: logger },
            { provide: POLL_RANDOM, useValue: random },
            { provide: CONNECTION_POLL_OPTIONS, useValue: { schedule: DEFAULT_POLL_SCHEDULE, redis: undefined } },
            { provide: ConnectionsService, useValue: connections },
            { provide: PollScheduleService, useValue: schedule },
            { provide: PollReceiverRegistryService, useValue: receivers },
            { provide: PollReceiptsService, useValue: receipts },
            { provide: PollLimiterService, useValue: limiter },
            { provide: PollOwnerNoticeService, useValue: notice },
        ],
    }).compile()
    return {
        scheduler: moduleRef.get(PollSchedulerService),
        live,
        sandbox,
        imapLive,
        receipts,
        connections,
        schedule,
        limiter,
        notice,
        logger,
    }
}

describe("PollSchedulerService tick picking", () => {
    it("does nothing when no provider can be polled", async () => {
        const { scheduler, schedule } = await build({ empty: true })

        await expect(scheduler.tick()).resolves.toEqual(new Map())

        expect(schedule.enroll).not.toHaveBeenCalled()
    })

    it("enrolls the providers and claims only a batch of what is due", async () => {
        const { scheduler, schedule } = await build()

        await scheduler.tick()

        expect(schedule.enroll).toHaveBeenCalledWith(["sepay", "imap", "smtp"])
        expect(schedule.claimDue).toHaveBeenCalledWith(["sepay", "imap", "smtp"], DEFAULT_POLL_SCHEDULE.batchSize)
    })

    it("polls the claimed connections one workspace after the other so none starves", async () => {
        const { scheduler, schedule, connections } = await build()
        schedule.claimDue.mockResolvedValue([
            dueOf({ connectionId: "a1", workspaceId: "a" }),
            dueOf({ connectionId: "a2", workspaceId: "a" }),
            dueOf({ connectionId: "b1", workspaceId: "b" }),
        ])

        await scheduler.tick()

        expect(connections.find.mock.calls.map(([, id]) => id)).toEqual(["a1", "b1", "a2"])
    })

    it("logs the metrics of each provider once per tick with the lag of the latest poll", async () => {
        const { scheduler, schedule, logger } = await build()
        schedule.claimDue.mockResolvedValue([dueOf({}, 4000), dueOf({ connectionId: "c-2" }, 9000)])

        const tallies = await scheduler.tick()

        expect(tallies.get("sepay")).toMatchObject({ polled: 2, found: 4, missedByWebhook: 4, maxLagMs: 9000 })
        expect(logger.info).toHaveBeenCalledWith(
            ConnectionPollLogEvent.Metrics,
            expect.objectContaining({ provider: "sepay", polled: 2, maxLagMs: 9000 }),
        )
    })
})

describe("PollSchedulerService connections that cannot be polled", () => {
    it.each([
        ["a connection that is gone", null],
        ["a disconnected connection", pollConnectionRecordOf({ status: "disconnected" })],
    ])("plans %s again at the healthy interval without polling it", async (_name, found) => {
        const { scheduler, schedule, connections, live } = await build()
        schedule.claimDue.mockResolvedValue([dueOf()])
        connections.find.mockResolvedValue(found)

        await scheduler.tick()

        expect(live.read).not.toHaveBeenCalled()
        expect(schedule.defer).toHaveBeenCalledWith("c-1", new Date(NOW_MS + 30 * MIN))
    })

    it("plans a connection whose provider has no receiver again without polling it", async () => {
        const { scheduler, schedule, connections, live } = await build()
        connections.find.mockResolvedValue(pollConnectionRecordOf({ provider: "casso" }))
        schedule.claimDue.mockResolvedValue([dueOf({ provider: "casso" })])

        await scheduler.tick()

        expect(live.read).not.toHaveBeenCalled()
        expect(schedule.defer).toHaveBeenCalledTimes(1)
    })

    it("plans a connection again shortly when the provider's concurrency cap is full", async () => {
        const { scheduler, schedule, limiter, live } = await build()
        schedule.claimDue.mockResolvedValue([dueOf()])
        limiter.enter.mockResolvedValue(undefined)

        const tallies = await scheduler.tick()

        expect(live.read).not.toHaveBeenCalled()
        expect(schedule.defer).toHaveBeenCalledWith("c-1", new Date(NOW_MS + 5000))
        expect(tallies.get("sepay")?.deferred).toBe(1)
    })
})

describe("PollSchedulerService a poll that read", () => {
    it("plans the next poll from the adaptive interval, releases the slot and counts the items", async () => {
        const { scheduler, schedule, limiter } = await build()
        schedule.claimDue.mockResolvedValue([dueOf()])
        const release = jest.fn().mockResolvedValue(undefined)
        limiter.enter.mockResolvedValue({ release })

        await scheduler.tick()

        expect(limiter.enter).toHaveBeenCalledWith("sepay", "c-1", limits)
        expect(release).toHaveBeenCalledTimes(1)
        expect(schedule.settle).toHaveBeenCalledWith(
            "c-1",
            expect.objectContaining({ nextPollAt: NOW_MS + CADENCE.besideWebhookMs, failures: 0, succeeded: true }),
        )
    })

    it("takes a token of the connection's bucket before every call to the provider", async () => {
        const { scheduler, schedule, limiter } = await build()
        schedule.claimDue.mockResolvedValue([dueOf()])

        await scheduler.tick()

        expect(limiter.pass).toHaveBeenCalledWith("sepay", "c-1", limits)
    })

    it("does not count a connection the provider could not read as a read", async () => {
        const { scheduler, schedule, live } = await build()
        schedule.claimDue.mockResolvedValue([dueOf()])
        live.read.mockResolvedValue({ kind: "skipped", reason: "no_token" })

        const tallies = await scheduler.tick()

        expect(tallies.get("sepay")).toMatchObject({ found: 0, missedByWebhook: 0 })
        expect(schedule.settle).toHaveBeenCalledWith("c-1", expect.objectContaining({ succeeded: false }))
    })

    it("clears the degraded mark when the probe of an open breaker reads", async () => {
        const built = await build({ classified: { kind: "fatal" } })
        built.schedule.claimDue.mockResolvedValue([dueOf({ breakerState: "open", failures: 5 })])
        built.live.read.mockResolvedValue({ kind: "page", items: [], fetched: 0, oldestAt: undefined, newestAt: undefined })
        await built.scheduler.tick()

        expect(built.connections.markHealth).toHaveBeenCalledWith("c-1", expect.objectContaining({ state: "ok" }))
        expect(built.connections.markRecovered).not.toHaveBeenCalled()
    })

    it("lets an open breaker's due poll through as its probe and closes it on success", async () => {
        const { scheduler, schedule } = await build()
        schedule.claimDue.mockResolvedValue([
            dueOf({ breakerState: "open", failures: 5, breakerOpenedAt: new Date(NOW_MS - 20 * MIN) }),
        ])

        await scheduler.tick()

        expect(schedule.settle).toHaveBeenCalledWith(
            "c-1",
            expect.objectContaining({ breakerState: "closed", failures: 0 }),
        )
    })
})

/** Answers full pages, each older than the last, then an empty page: a provider with a long history. */
const olderPages = (poller: jest.Mocked<PollReceiver>, full = 100): void => {
    let served = 0
    poller.read.mockImplementation(() => {
        served += 1
        return Promise.resolve(
            served > full
                ? readPollPageOf(0, { items: [], oldestAt: undefined, newestAt: undefined })
                : readPollPageOf(200, { oldestAt: new Date(NOW_MS - served * 10 * MIN) }),
        )
    })
}

describe("PollSchedulerService backfill in chunks", () => {
    it("reads a first connect in a chunk of pages and carries where it stopped", async () => {
        const { scheduler, schedule, connections, live } = await build()
        connections.find.mockResolvedValue(pollConnectionRecordOf({ meta: {} }))
        schedule.claimDue.mockResolvedValue([dueOf()])
        olderPages(live)

        await scheduler.tick()

        expect(live.read).toHaveBeenCalledTimes(DEFAULT_POLL_SCHEDULE.backfillChunkPages)
        expect(connections.patch).not.toHaveBeenCalled()
        expect(schedule.settle).toHaveBeenCalledWith(
            "c-1",
            expect.objectContaining({
                intervalMs: DEFAULT_POLL_SCHEDULE.hotIntervalMs,
                backfillTo: NOW_MS - 20 * MIN,
                backfillNewest: NOW_MS - MIN,
            }),
        )
    })

    it("resumes at the page end the last chunk stopped at", async () => {
        const { scheduler, schedule, connections, live } = await build()
        connections.find.mockResolvedValue(pollConnectionRecordOf({ meta: {} }))
        schedule.claimDue.mockResolvedValue([
            dueOf({ backfillTo: new Date(NOW_MS - 30 * MIN), backfillNewest: new Date(NOW_MS - MIN) }),
        ])

        await scheduler.tick()

        expect(live.read).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ to: new Date(NOW_MS - 30 * MIN) }),
        )
        const [workspaceId, connectionId, patch] = connections.patch.mock.calls[0] ?? []
        expect([workspaceId, connectionId]).toEqual(["ws-1", "c-1"])
        expect(patch?.meta?.[POLL_CURSOR_KEY]).toBe(new Date(NOW_MS - MIN).toISOString())
        expect(schedule.settle).toHaveBeenCalledWith(
            "c-1",
            expect.objectContaining({ backfillTo: null, backfillNewest: null }),
        )
    })

    it("resumes without a newest instant when the earlier chunks read none", async () => {
        const { scheduler, schedule, connections, live } = await build()
        connections.find.mockResolvedValue(pollConnectionRecordOf({ meta: {} }))
        schedule.claimDue.mockResolvedValue([dueOf({ backfillTo: new Date(NOW_MS - 30 * MIN) })])
        live.read.mockResolvedValue(readPollPageOf(0, { items: [], oldestAt: undefined, newestAt: undefined }))

        await scheduler.tick()

        expect(live.read).toHaveBeenCalledTimes(1)
        expect(schedule.settle).toHaveBeenCalledWith("c-1", expect.objectContaining({ backfillTo: null }))
    })

    it("reads a connection that has a cursor without a page cap", async () => {
        const { scheduler, schedule, live } = await build()
        schedule.claimDue.mockResolvedValue([dueOf()])
        olderPages(live, 3)

        await scheduler.tick()

        expect(live.read).toHaveBeenCalledTimes(4)
    })
})

describe("PollSchedulerService failures", () => {
    const failing = async (failure: PollFailure, row: Partial<PollScheduleRow> = {}) => {
        const built = await build({ classified: failure })
        built.schedule.claimDue.mockResolvedValue([dueOf(row)])
        built.live.read.mockRejectedValue(new Error("provider failed"))
        const tallies = await built.scheduler.tick()
        return { ...built, tallies }
    }

    it("backs off a 429 for at least its Retry-After and counts it", async () => {
        const { schedule, tallies, notice } = await failing({ kind: "rate_limited", retryAfterSeconds: 600 })

        expect(tallies.get("sepay")?.rateLimited).toBe(1)
        expect(schedule.settle).toHaveBeenCalledWith(
            "c-1",
            expect.objectContaining({ nextPollAt: NOW_MS + 10 * MIN, breakerState: "closed", failures: 1 }),
        )
        expect(notice.needsReauth).not.toHaveBeenCalled()
    })

    it("retries a transient failure with backoff and opens the breaker at the threshold", async () => {
        const { schedule, tallies, logger } = await failing({ kind: "transient" }, { failures: 4 })

        expect(tallies.get("sepay")?.transient).toBe(1)
        expect(schedule.settle).toHaveBeenCalledWith(
            "c-1",
            expect.objectContaining({ breakerState: "open", failures: 5 }),
        )
        expect(logger.warn).toHaveBeenCalledWith(
            ConnectionPollLogEvent.BreakerOpened,
            expect.objectContaining({ connectionId: "c-1", kind: "transient" }),
        )
    })

    it("stops polling a refused credential, parks the connection and raises one owner work item", async () => {
        const { schedule, tallies, notice, logger } = await failing({ kind: "auth_failed" })

        expect(tallies.get("sepay")?.authFailed).toBe(1)
        expect(schedule.settle).toHaveBeenCalledWith(
            "c-1",
            expect.objectContaining({ needsReauth: true, breakerState: "open" }),
        )
        expect(notice.needsReauth).toHaveBeenCalledTimes(1)
        expect(notice.needsReauth).toHaveBeenCalledWith(expect.objectContaining({ id: "c-1" }), NOW_MS, undefined)
        expect(logger.warn).toHaveBeenCalledWith(
            ConnectionPollLogEvent.NeedsReauth,
            expect.objectContaining({ connectionId: "c-1" }),
        )
    })

    it("tells the owner when the credential lacks the permission the poll needs", async () => {
        const { notice } = await failing({ kind: "auth_failed", reason: "permission" })

        expect(notice.needsReauth).toHaveBeenCalledWith(expect.objectContaining({ id: "c-1" }), NOW_MS, "permission")
    })

    it("raises no second owner work item for a connection that is already parked", async () => {
        const { notice } = await failing({ kind: "auth_failed" }, { needsReauth: true })

        expect(notice.needsReauth).not.toHaveBeenCalled()
    })
})

describe("PollSchedulerService failures of the provider's side", () => {
    const failing = async (failure: PollFailure, row: Partial<PollScheduleRow> = {}) => {
        const built = await build({ classified: failure })
        built.schedule.claimDue.mockResolvedValue([dueOf(row)])
        built.live.read.mockRejectedValue(new Error("provider failed"))
        const tallies = await built.scheduler.tick()
        return { ...built, tallies }
    }

    it("is no failure when the provider's plan lacks the capability: the breaker stays closed and the owner is told once, in the provider's words", async () => {
        const { schedule, tallies, notice, logger } = await failing({
            kind: "unavailable",
            reason: "plan",
            notice: "upgrade the plan",
        })

        expect(tallies.get("sepay")?.unavailable).toBe(1)
        expect(schedule.settle).toHaveBeenCalledWith(
            "c-1",
            expect.objectContaining({
                breakerState: "closed",
                failures: 0,
                unavailableReason: "plan",
                nextPollAt: NOW_MS + DEFAULT_POLL_SCHEDULE.unavailableRecheckMs,
            }),
        )
        expect(notice.unavailable).toHaveBeenCalledTimes(1)
        expect(notice.unavailable).toHaveBeenCalledWith(
            expect.objectContaining({ id: "c-1" }),
            "upgrade the plan",
            NOW_MS,
        )
        expect(notice.needsReauth).not.toHaveBeenCalled()
        expect(logger.warn).toHaveBeenCalledWith(
            ConnectionPollLogEvent.Unavailable,
            expect.objectContaining({ connectionId: "c-1", reason: "plan" }),
        )
        expect(logger.warn).not.toHaveBeenCalledWith(ConnectionPollLogEvent.BreakerOpened, expect.anything())
    })

    it("tells the owner nothing more while the capability stays unavailable", async () => {
        const { notice } = await failing(
            { kind: "unavailable", reason: "plan", notice: "upgrade the plan" },
            { unavailableReason: "plan" },
        )

        expect(notice.unavailable).not.toHaveBeenCalled()
    })

    it("marks a connection degraded when the breaker opens for a reason that is no refused credential, and never for a refused one", async () => {
        const fatal = await failing({ kind: "fatal" })
        expect(fatal.connections.markHealth).toHaveBeenCalledWith("c-1", expect.objectContaining({ state: "degraded" }))
        const refused = await failing({ kind: "auth_failed" })
        expect(refused.connections.markHealth).not.toHaveBeenCalled()
        const slow = await failing({ kind: "transient" }, { failures: 0 })
        expect(slow.connections.markHealth).not.toHaveBeenCalled()
    })

    it("opens the breaker for a fatal failure without the owner", async () => {
        const { schedule, tallies, notice } = await failing({ kind: "fatal" })

        expect(tallies.get("sepay")?.fatal).toBe(1)
        expect(schedule.settle).toHaveBeenCalledWith(
            "c-1",
            expect.objectContaining({ breakerState: "open", needsReauth: false }),
        )
        expect(notice.needsReauth).not.toHaveBeenCalled()
    })
})

describe("PollSchedulerService a poll that waited for the rate limit", () => {
    it("plans the connection again after the wait the limiter named, and is no failure", async () => {
        const { scheduler, schedule, limiter, live, logger } = await build()
        schedule.claimDue.mockResolvedValue([dueOf()])
        limiter.pass.mockRejectedValue(
            new ConnectionPollError({ code: ConnectionPollErrorCode.Deferred, params: { waitMs: 12_000 } }),
        )

        const tallies = await scheduler.tick()

        expect(tallies.get("sepay")?.deferred).toBe(1)
        expect(schedule.defer).toHaveBeenCalledWith("c-1", new Date(NOW_MS + 12_000))
        expect(schedule.settle).not.toHaveBeenCalled()
        expect(live.classify).not.toHaveBeenCalled()
        expect(logger.info).toHaveBeenCalledWith(
            ConnectionPollLogEvent.Deferred,
            expect.objectContaining({ connectionId: "c-1" }),
        )
    })

    it("falls back to a short wait when the error names none that can be read", async () => {
        const { scheduler, schedule, limiter } = await build()
        schedule.claimDue.mockResolvedValue([dueOf()])
        limiter.pass.mockRejectedValue(new ConnectionPollError({ code: ConnectionPollErrorCode.Deferred }))

        await scheduler.tick()

        expect(schedule.defer).toHaveBeenCalledWith("c-1", new Date(NOW_MS + 5000))
    })

})

describe("PollSchedulerService the receivers of the one registry", () => {
    it("polls the providers that have a receiver and every provider whose accounts may hold the half of one", async () => {
        const { scheduler, schedule } = await build()

        await scheduler.tick()

        expect(schedule.enroll).toHaveBeenCalledWith(["sepay", "imap", "smtp"])
        expect(schedule.claimDue).toHaveBeenCalledWith(["sepay", "imap", "smtp"], DEFAULT_POLL_SCHEDULE.batchSize)
    })

    it("reads a mailbox smtp account through the receiver of the imap half it holds, under that provider's limits", async () => {
        const { scheduler, schedule, connections, live, imapLive, limiter, receipts } = await build()
        const mailbox = pollConnectionRecordOf({ provider: "smtp", meta: { config: "sealed" } })
        connections.find.mockResolvedValue(mailbox)
        schedule.claimDue.mockResolvedValue([dueOf({ provider: "smtp" })])

        await scheduler.tick()

        expect(imapLive.read).toHaveBeenCalledWith(mailbox, expect.objectContaining({ limit: 200 }))
        expect(live.read).not.toHaveBeenCalled()
        expect(limiter.enter).toHaveBeenCalledWith("imap", "c-1", limits)
        expect(receipts.keep).toHaveBeenCalledWith(mailbox, "imap.mail", expect.any(Array))
    })

    it("leaves a smtp account that holds no inbound half alone and plans it again", async () => {
        const { scheduler, schedule, connections, imapLive } = await build()
        connections.find.mockResolvedValue(pollConnectionRecordOf({ provider: "smtp", meta: {} }))
        schedule.claimDue.mockResolvedValue([dueOf({ provider: "smtp" })])

        await scheduler.tick()

        expect(imapLive.read).not.toHaveBeenCalled()
        expect(schedule.defer).toHaveBeenCalledTimes(1)
        expect(schedule.settle).not.toHaveBeenCalled()
    })

    it("keeps the rows of the walk under the receiver's data type through the generic store", async () => {
        const { scheduler, schedule, receipts, connections } = await build()
        schedule.claimDue.mockResolvedValue([dueOf()])

        await scheduler.tick()

        expect(receipts.keep).toHaveBeenCalledWith(pollConnectionRecordOf(), "sepay.transaction", readPollPageOf(2).items)
    })
})

describe("PollSchedulerService live and sandbox accounts", () => {
    it("reads a live account through the live receiver and never the sandbox one", async () => {
        const { scheduler, schedule, live, sandbox } = await build()
        schedule.claimDue.mockResolvedValue([dueOf()])

        await scheduler.tick()

        expect(live.read).toHaveBeenCalledTimes(1)
        expect(sandbox.read).not.toHaveBeenCalled()
    })

    it("reads a sandbox account through the sandbox receiver and never the live one (the one switch)", async () => {
        const { scheduler, schedule, connections, live, sandbox } = await build()
        connections.find.mockResolvedValue(pollConnectionRecordOf({ sandbox: true }))
        schedule.claimDue.mockResolvedValue([dueOf()])

        await scheduler.tick()

        expect(sandbox.read).toHaveBeenCalledTimes(1)
        expect(live.read).not.toHaveBeenCalled()
    })
})

describe("PollSchedulerService the cadence of the receiver", () => {
    it("plans the sparse interval while the webhook beside the poll delivers", async () => {
        const { scheduler, schedule } = await build()
        schedule.claimDue.mockResolvedValue([dueOf({ lastWebhookAt: new Date(NOW_MS - MIN) })])

        await scheduler.tick()

        expect(schedule.settle).toHaveBeenCalledWith("c-1", expect.objectContaining({ nextPollAt: NOW_MS + CADENCE.besideWebhookMs }))
    })

    it("plans the dense interval when no webhook was ever heard", async () => {
        const { scheduler, schedule } = await build()
        schedule.claimDue.mockResolvedValue([dueOf({ lastWebhookAt: null })])

        await scheduler.tick()

        expect(schedule.settle).toHaveBeenCalledWith("c-1", expect.objectContaining({ nextPollAt: NOW_MS + CADENCE.aloneMs }))
    })

    it("plans the dense interval when the webhook has been silent longer than the declared silence", async () => {
        const { scheduler, schedule } = await build()
        const silent = NOW_MS - DEFAULT_POLL_SCHEDULE.webhookSilentAfterMs - MIN
        schedule.claimDue.mockResolvedValue([dueOf({ lastWebhookAt: new Date(silent) })])

        await scheduler.tick()

        expect(schedule.settle).toHaveBeenCalledWith("c-1", expect.objectContaining({ nextPollAt: NOW_MS + CADENCE.aloneMs }))
    })
})

describe("PollSchedulerService ready", () => {
    it("makes the account of a polled provider ready and hot", async () => {
        const { scheduler, schedule } = await build()

        await expect(scheduler.ready({ connectionId: "c-9", provider: "sepay" })).resolves.toBe(true)

        expect(schedule.markReady).toHaveBeenCalledWith("c-9")
    })

    it("also takes a provider whose accounts hold the half of a polled one (a mailbox smtp account)", async () => {
        const { scheduler, schedule } = await build()

        await expect(scheduler.ready({ connectionId: "c-9", provider: "smtp" })).resolves.toBe(true)

        expect(schedule.markReady).toHaveBeenCalledWith("c-9")
    })

    it("does nothing for a provider that is not polled", async () => {
        const { scheduler, schedule } = await build()

        await expect(scheduler.ready({ connectionId: "c-9", provider: "telegram" })).resolves.toBe(false)

        expect(schedule.markReady).not.toHaveBeenCalled()
    })
})
