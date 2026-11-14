import { Test } from "@nestjs/testing"
import { FakeClock, mock, mockEntityManager, queueQueryBuilders } from "@starci/jest-preset"
import { CLOCK } from "@modules/platform/clock"
import { LOGGER, type Logger } from "@modules/platform/logging"
import { REALTIME_HUB, type RealtimeHub } from "@modules/platform/realtime"
import { JobsError, JobsErrorCode } from "./errors/jobs.error"
import type { ClaimedJob } from "./jobs.contracts"
import { JOBS_MANAGERS } from "./jobs.decorators"
import { JobsLogEvent } from "./jobs.log-events"
import { JobProgressService } from "./job-progress.service"

const job: ClaimedJob = { jobId: "j-1", kind: "knowledge.index", fencingToken: 3, currentStep: null, payload: {} }
const NOW = new Date("2026-11-14T10:00:00.000Z")
const TOPIC = "job-progress:ws-1:knowledge-source:s1"

/** A manager whose one update statement answers the given raw rows; the statement's chained calls are read back through `builders`. */
const managerAnswering = (raw: ReadonlyArray<object>) => {
    const manager = mockEntityManager()
    const [builder] = queueQueryBuilders(manager, [{ execute: { raw } }])
    return { manager, builder }
}

/** A manager whose update statements answer nothing; the statements are read back through `builders`. */
const buildWriter = async () => {
    const manager = mockEntityManager()
    const builders = queueQueryBuilders(manager, [{ execute: { raw: [] } }])
    const moduleRef = await Test.createTestingModule({
        providers: [
            JobProgressService,
            { provide: JOBS_MANAGERS, useValue: [manager] },
            { provide: CLOCK, useValue: new FakeClock(NOW) },
            { provide: LOGGER, useValue: mock<Logger>() },
        ],
    }).compile()
    return { service: moduleRef.get(JobProgressService), builder: builders[0] }
}

const build = async (raw: ReadonlyArray<object>, withHub = true) => {
    const { manager, builder } = managerAnswering(raw)
    const hub = mock<RealtimeHub>()
    hub.publish.mockResolvedValue(undefined)
    const logger = mock<Logger>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            JobProgressService,
            { provide: JOBS_MANAGERS, useValue: [manager] },
            { provide: CLOCK, useValue: new FakeClock(NOW) },
            { provide: LOGGER, useValue: logger },
            ...(withHub ? [{ provide: REALTIME_HUB, useValue: hub }] : []),
        ],
    }).compile()
    return { service: moduleRef.get(JobProgressService), hub, logger, written: () => builder?.callsOf("set") ?? [] }
}

describe("JobProgressService report", () => {
    it("stores the step numbers on the row and publishes them to the topic the row recorded", async () => {
        const { service, hub, written } = await build([{ kind: "knowledge.index", progress_topic: TOPIC }])

        await service.report(job, 2, 5, "embed")

        expect(written()).toEqual([[{ progressDone: 2, progressTotal: 5, progressLabel: "embed", progressAt: NOW }]])
        const [topic, frame] = hub.publish.mock.calls[0] ?? []
        expect(topic?.name).toBe("job-progress:ws-1")
        expect(frame).toMatchObject({
            kind: "job",
            root: "knowledge-source:s1",
            job: "knowledge.index",
            jobId: "j-1",
            state: "running",
            done: 2,
            total: 5,
            labelKey: "embed",
        })
    })

    it("only stores the numbers when the row recorded no topic", async () => {
        const { service, hub, written } = await build([{ kind: "knowledge.index", progress_topic: null }])

        await service.report(job, 1, 2, "read")

        expect(written()).toHaveLength(1)
        expect(hub.publish).not.toHaveBeenCalled()
    })

    it("is refused for a stale token and publishes nothing", async () => {
        const { service, hub } = await build([])

        await expect(service.report(job, 1, 2, "read")).rejects.toMatchObject(
            new JobsError({ code: JobsErrorCode.FencedOut, params: { jobId: "j-1", token: 3 } }),
        )
        expect(hub.publish).not.toHaveBeenCalled()
    })

    it("never fails the job when the hub cannot publish: it logs", async () => {
        const { service, hub, logger } = await build([{ kind: "knowledge.index", progress_topic: TOPIC }])
        hub.publish.mockRejectedValue(new Error("hub down"))

        await expect(service.report(job, 1, 2, "read")).resolves.toBeUndefined()
        expect(logger.error).toHaveBeenCalledWith(
            JobsLogEvent.ProgressNotPublished,
            expect.any(Error),
            expect.objectContaining({ jobId: "j-1" }),
        )
    })

    it("stores the numbers in an app with no hub", async () => {
        const { service, written } = await build([{ kind: "knowledge.index", progress_topic: TOPIC }], false)

        await expect(service.report(job, 1, 2, "read")).resolves.toBeUndefined()
        expect(written()).toHaveLength(1)
    })
})

describe("JobProgressService publishTo", () => {
    it("publishes a frame ONCE, to the topic of the workspace, carrying the root of the chain", async () => {
        const { service, hub } = await build([])

        await service.publishTo({ topicName: "job-progress:ws-1:knowledge-source:s2", job, jobName: "knowledge.index", state: "done", change: {}, at: NOW })

        expect(hub.publish).toHaveBeenCalledTimes(1)
        const [topic, frame] = hub.publish.mock.calls[0] ?? []
        expect(topic?.name).toBe("job-progress:ws-1")
        expect(frame).toMatchObject({ root: "knowledge-source:s2", state: "done", jobId: "j-1" })
    })

    it("logs and publishes nothing for a recorded name that is not a chain name", async () => {
        const { service, hub, logger } = await build([])

        await service.publishTo({ topicName: "not-a-chain", job, jobName: "knowledge.index", state: "done", change: {}, at: NOW })

        expect(hub.publish).not.toHaveBeenCalled()
        expect(logger.error).toHaveBeenCalledWith(JobsLogEvent.ProgressNotPublished, expect.any(Error), expect.objectContaining({ jobId: "j-1" }))
    })
})

describe("JobProgressService recordRetry and record", () => {
    it("stores when the retry runs again, guarded by the failed status and not by the token", async () => {
        const { service, builder } = await buildWriter()
        const retryAt = new Date("2026-11-14T10:00:30.000Z")

        await service.recordRetry(job, retryAt)

        expect(builder?.callsOf("set")).toEqual([[{ progressRetryAt: retryAt }]])
        expect(builder?.callsOf("where")).toEqual([["id = :id AND status = :failed", { id: "j-1", failed: "failed" }]])
    })

    it("clears a stale retry time when it records the topic of a running job", async () => {
        const { service, builder } = await buildWriter()

        await service.record(job, TOPIC)

        expect(builder?.callsOf("set")).toEqual([[{ progressTopic: TOPIC, progressRetryAt: null }]])
    })
})
