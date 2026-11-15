import { Test } from "@nestjs/testing"
import { FakeClock, mock } from "@starci/jest-preset"
import { CLOCK } from "@modules/platform/clock"
import { TIMER, type Timer } from "@modules/platform/retry"
import { CONNECTION_POLL_OPTIONS, POLL_LIMITER_STORE } from "./connection-poll.decorators"
import { ConnectionPollError, ConnectionPollErrorCode } from "./errors/connection-poll.error"
import type { PollLimiterStore } from "./poll-limiter.contracts"
import { MAX_TOKEN_WAIT_MS, TOKEN_WAIT_ATTEMPTS } from "./poll-bucket.policy"
import { PollLimiterService } from "./poll-limiter.service"
import { DEFAULT_POLL_SCHEDULE } from "./poll-schedule.policy"

const limits = { ratePerSecond: 2, burst: 2, concurrency: 1 }

const build = async () => {
    const store = mock<PollLimiterStore>()
    const timer = mock<Timer>()
    timer.schedule.mockImplementation((callback) => {
        callback()
        return () => undefined
    })
    const moduleRef = await Test.createTestingModule({
        providers: [
            PollLimiterService,
            { provide: CLOCK, useValue: new FakeClock("2026-11-04T10:00:00.000Z") },
            { provide: POLL_LIMITER_STORE, useValue: store },
            { provide: TIMER, useValue: timer },
            { provide: CONNECTION_POLL_OPTIONS, useValue: { schedule: DEFAULT_POLL_SCHEDULE, redis: undefined } },
        ],
    }).compile()
    return { service: moduleRef.get(PollLimiterService), store, timer }
}

describe("PollLimiterService enter", () => {
    it("takes a slot of the provider for the connection and gives it back on release", async () => {
        const { service, store } = await build()
        store.enter.mockResolvedValue(true)

        const slot = await service.enter("sepay", "c-1", limits)
        await slot?.release()

        expect(store.enter).toHaveBeenCalledWith(
            "sepay",
            "c-1",
            1,
            DEFAULT_POLL_SCHEDULE.leaseMs,
            Date.parse("2026-11-04T10:00:00.000Z"),
        )
        expect(store.leave).toHaveBeenCalledWith("sepay", "c-1")
    })

    it("answers nothing when every slot is taken", async () => {
        const { service, store } = await build()
        store.enter.mockResolvedValue(false)

        await expect(service.enter("sepay", "c-1", limits)).resolves.toBeUndefined()
    })
})

describe("PollLimiterService pass", () => {
    it("lets a call through at once when the bucket holds a token", async () => {
        const { service, store } = await build()
        store.take.mockResolvedValue({ allowed: true, waitMs: 0 })

        await expect(service.pass("sepay", "c-1", limits)).resolves.toBeUndefined()

        expect(store.take).toHaveBeenCalledWith("sepay:c-1", limits, Date.parse("2026-11-04T10:00:00.000Z"))
    })

    it("waits for the refill the limit names and then takes: a read of several calls is paced, never thrown away", async () => {
        const { service, store, timer } = await build()
        store.take
            .mockResolvedValueOnce({ allowed: false, waitMs: 400 })
            .mockResolvedValueOnce({ allowed: true, waitMs: 0 })

        await expect(service.pass("sepay", "c-1", limits)).resolves.toBeUndefined()

        expect(timer.schedule).toHaveBeenCalledTimes(1)
        expect(timer.schedule).toHaveBeenCalledWith(expect.any(Function), 400)
        expect(store.take).toHaveBeenCalledTimes(2)
    })

    it("ends the poll with the wait the limit names when it is longer than the call may wait: it is planned again, nothing sleeps", async () => {
        const { service, store, timer } = await build()
        store.take.mockResolvedValue({ allowed: false, waitMs: MAX_TOKEN_WAIT_MS + 1 })

        const failure = await service.pass("sepay", "c-1", limits).catch((cause: unknown) => cause)

        expect(failure).toBeInstanceOf(ConnectionPollError)
        expect(failure).toMatchObject({ code: ConnectionPollErrorCode.Deferred, params: { waitMs: MAX_TOKEN_WAIT_MS + 1 } })
        expect(store.take).toHaveBeenCalledTimes(1)
        expect(timer.schedule).not.toHaveBeenCalled()
    })

    it("ends the poll after the declared number of waits when another replica keeps taking the refilled token", async () => {
        const { service, store, timer } = await build()
        store.take.mockResolvedValue({ allowed: false, waitMs: 250 })

        const failure = await service.pass("sepay", "c-1", limits).catch((cause: unknown) => cause)

        expect(failure).toMatchObject({ code: ConnectionPollErrorCode.Deferred, params: { waitMs: 250 } })
        expect(store.take).toHaveBeenCalledTimes(TOKEN_WAIT_ATTEMPTS)
        expect(timer.schedule).toHaveBeenCalledTimes(TOKEN_WAIT_ATTEMPTS - 1)
    })
})
