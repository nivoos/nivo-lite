import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { QUEUE_WORKER_REGISTRY, QueueError, QueueErrorCode } from "@modules/platform/queue"
import type { QueueDelivery, QueueWorkerRegistry } from "@modules/platform/queue"
import { JobsError, JobsErrorCode } from "./errors/jobs.error"
import type { FencedProcessor } from "./fenced.processor"
import type { ClaimedJob } from "./jobs.contracts"
import { JOB_CLAIMS, JOBS_OPTIONS } from "./jobs.decorators"
import { JobsLogEvent } from "./jobs.log-events"
import type { JobsOptions } from "./jobs.options"
import type { JobClaims } from "./jobs.port"
import { defineJob } from "./job-definition"
import { JobDeadLettersService } from "./job-dead-letters.service"
import { JobRenewalService } from "./job-renewal.service"
import { JobRunnerService } from "./job-runner.service"
import { JobStateEventsService } from "./job-state-events.service"

const options: JobsOptions = { connection: "primary", workerId: "w-1", leaseMs: 60000, scheduler: { enabled: false } }
const delivery: QueueDelivery = {
    id: "k-1",
    queue: "mail",
    job: "mail.send",
    payload: { id: "m-1" },
    attempt: 1,
    signal: new AbortController().signal,
}
const job: ClaimedJob = { jobId: "j-1", kind: "mail", fencingToken: 2, currentStep: null, payload: { id: "m-1" } }
const WS = "11111111-1111-4111-8111-111111111111"
const fenced = (): JobsError => new JobsError({ code: JobsErrorCode.FencedOut, params: { jobId: "j-1", token: 2 } })

/** A failure of the network: the classifier calls it transient. */
const transient = (): Error => Object.assign(new Error("provider down"), { code: "ECONNRESET" })
/** A failure that names its class, as a flow does when no retry can fix it. */
const refused = (failureClass: "input" | "code" | "config"): QueueError =>
    new QueueError({ code: QueueErrorCode.FlowFailure, params: { failureClass, reason: "refused" } })

const isMailPayload = (value: unknown): value is { readonly id: string } =>
    typeof value === "object" && value !== null && "id" in value && typeof value.id === "string"
/** A job on the waited ladder with a payload guard. */
const MAIL_JOB = defineJob({
    name: "mail.send",
    queue: "mail",
    ladder: "waited",
    payload: isMailPayload,
    onceKey: (payload) => `mail.send:${payload.id}`,
    next: [],
    effects: [],
})

/** A processor with every optional field named, so the mock never answers one with a function. */
const processorOf = (own: Partial<Pick<FencedProcessor, "job" | "scheduled" | "definition">>) =>
    mock<FencedProcessor>({
        queue: "mail",
        job: undefined,
        concurrency: undefined,
        scheduled: undefined,
        definition: undefined,
        ...own,
    })

const build = async () => {
    const claims = mock<JobClaims>()
    claims.park.mockResolvedValue(true)
    claims.fail.mockResolvedValue(undefined)
    claims.release.mockResolvedValue(undefined)
    claims.retryAfterSeconds.mockResolvedValue(null)
    const queues = mock<QueueWorkerRegistry>()
    const logger = mock<Logger>()
    const renewals = mock<JobRenewalService>()
    const deadLetters = mock<JobDeadLettersService>()
    deadLetters.raise.mockResolvedValue(undefined)
    const states = mock<JobStateEventsService>()
    states.changed.mockResolvedValue(undefined)
    const stop = jest.fn()
    renewals.keep.mockReturnValue({ stop })
    const moduleRef = await Test.createTestingModule({
        providers: [
            JobRunnerService,
            { provide: JOBS_OPTIONS, useValue: options },
            { provide: JOB_CLAIMS, useValue: claims },
            { provide: QUEUE_WORKER_REGISTRY, useValue: queues },
            { provide: LOGGER, useValue: logger },
            { provide: JobRenewalService, useValue: renewals },
            { provide: JobDeadLettersService, useValue: deadLetters },
            { provide: JobStateEventsService, useValue: states },
        ],
    }).compile()
    return {
        runner: moduleRef.get(JobRunnerService),
        renewals,
        stop,
        claims,
        queues,
        logger,
        deadLetters,
        states,
        processor: processorOf({}),
    }
}

describe("JobRunnerService", () => {
    describe("add", () => {
        it("subscribes the processor to its queue, and the handler runs a delivery through the fence", async () => {
            const { runner, claims, queues, processor } = await build()
            claims.claim.mockResolvedValue(job)
            runner.add(processor)
            const handler = queues.add.mock.calls[0]?.[0]

            await handler?.handle(delivery)

            expect(handler?.queue).toBe("mail")
            expect(handler?.job).toBeUndefined()
            expect(processor.process).toHaveBeenCalledWith(job)
        })

        it("subscribes a processor that names a definition to the job of the definition", async () => {
            const { runner, queues } = await build()

            runner.add(processorOf({ definition: MAIL_JOB }))

            expect(queues.add.mock.calls[0]?.[0]).toMatchObject({ queue: "mail", job: "mail.send" })
        })

        it("subscribes with the job and concurrency and hands failures to the processor", async () => {
            const { runner, queues } = await build()
            const processor = mock<FencedProcessor>({
                queue: "mail",
                job: "mail.send",
                definition: undefined,
                concurrency: 2,
                scheduled: true,
                workspaceHeadroom: 2,
                fairGroupOf: () => Promise.resolve("document:d1"),
            })
            const cause = new Error("gave up")
            runner.add(processor)
            const handler = queues.add.mock.calls[0]?.[0]

            await handler?.failed?.(delivery, cause)

            expect(handler).toMatchObject({
                queue: "mail",
                job: "mail.send",
                concurrency: 2,
                scheduled: true,
                workspaceHeadroom: 2,
            })
            expect(processor.onFailed).toHaveBeenCalledWith(delivery, cause)
            await expect(handler?.fairGroupOf?.("mail.send", {})).resolves.toBe("document:d1")
        })
    })
})

describe("JobRunnerService", () => {
    describe("run", () => {
        it("claims with the job key and lease, processes and completes under the claimed token", async () => {
            const { runner, claims, processor } = await build()
            claims.claim.mockResolvedValue(job)

            await runner.run(processor, delivery)

            expect(claims.claim).toHaveBeenCalledWith({
                kind: "mail",
                jobKey: "k-1",
                payload: { id: "m-1" },
                workerId: "w-1",
                leaseMs: 60000,
            })
            expect(processor.process).toHaveBeenCalledWith(job)
            expect(claims.complete).toHaveBeenCalledWith({ jobId: "j-1", expectedFencingToken: 2 })
            expect(claims.fail).not.toHaveBeenCalled()
            expect(claims.park).not.toHaveBeenCalled()
        })

        it("keeps the lease of the claim while the processor runs and lets go of it when it ends, whether it succeeds or fails", async () => {
            const { runner, claims, renewals, stop, processor } = await build()
            claims.claim.mockResolvedValue(job)
            processor.process.mockRejectedValueOnce(transient()).mockResolvedValueOnce(undefined)

            await expect(runner.run(processor, delivery)).rejects.toMatchObject({ code: QueueErrorCode.RetryAfter })
            await runner.run(processor, delivery)

            expect(renewals.keep).toHaveBeenCalledTimes(2)
            expect(renewals.keep).toHaveBeenCalledWith(job)
            expect(stop).toHaveBeenCalledTimes(2)
        })

        it("claims a processor of one job under the job name as the kind", async () => {
            const { runner, claims } = await build()
            claims.claim.mockResolvedValue(job)

            await runner.run(processorOf({ job: "mail.send" }), delivery)

            expect(claims.claim).toHaveBeenCalledWith(expect.objectContaining({ kind: "mail.send" }))
        })

        it("claims a processor of a definition under the definition's name", async () => {
            const { runner, claims } = await build()
            claims.claim.mockResolvedValue(job)

            await runner.run(processorOf({ definition: MAIL_JOB }), delivery)

            expect(claims.claim).toHaveBeenCalledWith(expect.objectContaining({ kind: "mail.send" }))
        })

        it("tells the state changes: running with the start, then done", async () => {
            const { runner, claims, states, processor } = await build()
            claims.claim.mockResolvedValue(job)

            await runner.run(processor, { ...delivery, attempt: 2 })

            expect(states.changed.mock.calls.map(([, , change]) => change)).toEqual([
                { kind: "running", attempt: 2 },
                { kind: "done" },
            ])
        })
    })
})

describe("JobRunnerService", () => {
    describe("refused claims", () => {
        it("acknowledges a refused claim only when the job is confirmed done", async () => {
            const { runner, claims, processor } = await build()
            claims.claim.mockResolvedValue(null)

            await runner.run(processor, delivery)

            expect(processor.process).not.toHaveBeenCalled()
            expect(claims.complete).not.toHaveBeenCalled()
            expect(claims.retryAfterSeconds).toHaveBeenCalledWith(delivery.id)
        })

        it("defers a refused live claim without processing, completing or recording a failure", async () => {
            const { runner, claims, processor } = await build()
            claims.claim.mockResolvedValue(null)
            claims.retryAfterSeconds.mockResolvedValue(42)

            await expect(runner.run(processor, delivery)).rejects.toMatchObject({
                code: QueueErrorCode.DeferredUntil,
                params: { job: delivery.job, seconds: 42 },
            })

            expect(processor.process).not.toHaveBeenCalled()
            expect(claims.complete).not.toHaveBeenCalled()
            expect(claims.fail).not.toHaveBeenCalled()
            expect(claims.park).not.toHaveBeenCalled()
        })

        it("keeps a failed disposition check retryable instead of acknowledging the delivery", async () => {
            const { runner, claims, processor } = await build()
            const failure = new Error("claim state unavailable")
            claims.claim.mockResolvedValue(null)
            claims.retryAfterSeconds.mockRejectedValue(failure)

            await expect(runner.run(processor, delivery)).rejects.toBe(failure)

            expect(processor.process).not.toHaveBeenCalled()
            expect(claims.complete).not.toHaveBeenCalled()
            expect(claims.fail).not.toHaveBeenCalled()
        })
    })
})

describe("JobRunnerService", () => {
    describe("fenced out and deferred", () => {
        it("stops with no further effect when a newer worker fences out the completion", async () => {
            const { runner, claims, logger, processor } = await build()
            claims.claim.mockResolvedValue(job)
            claims.complete.mockRejectedValue(fenced())

            await expect(runner.run(processor, delivery)).resolves.toBeUndefined()

            expect(logger.warn).toHaveBeenCalledWith(JobsLogEvent.FencedOut, { jobId: "j-1" })
            expect(claims.fail).not.toHaveBeenCalled()
            expect(claims.park).not.toHaveBeenCalled()
        })

        it("gives back a job whose handler asked to run later, logged at info and recorded as no failure", async () => {
            const { runner, claims, logger, processor } = await build()
            claims.claim.mockResolvedValue(job)
            const later = new QueueError({ code: QueueErrorCode.DeferredUntil, params: { seconds: 5 } })
            processor.process.mockRejectedValue(later)

            await expect(runner.run(processor, delivery)).rejects.toBe(later)

            expect(claims.release).toHaveBeenCalledWith({ jobId: "j-1", expectedFencingToken: 2 })
            expect(claims.fail).not.toHaveBeenCalled()
            expect(claims.park).not.toHaveBeenCalled()
            expect(logger.info).toHaveBeenCalledWith(JobsLogEvent.Deferred, { jobId: "j-1", seconds: 5 })
            expect(logger.error).not.toHaveBeenCalled()

            const storeDown = new Error("store down")
            claims.release.mockRejectedValueOnce(fenced()).mockRejectedValueOnce(storeDown)
            await expect(runner.run(processor, delivery)).rejects.toBe(later)
            expect(logger.warn).toHaveBeenCalledWith(JobsLogEvent.FencedOut, { jobId: "j-1" })
            await expect(runner.run(processor, delivery)).rejects.toBe(later)
            expect(logger.error).toHaveBeenCalledWith(JobsLogEvent.FailureNotRecorded, storeDown, { jobId: "j-1" })
        })
    })
})

describe("JobRunnerService", () => {
    describe("a transient failure with starts left", () => {
        it("fails the job under its token and hands the delivery back with the pause of the background ladder", async () => {
            const { runner, claims, logger, states, processor, deadLetters } = await build()
            claims.claim.mockResolvedValue(job)
            const failure = transient()
            processor.process.mockRejectedValue(failure)

            await expect(runner.run(processor, delivery)).rejects.toMatchObject({
                code: QueueErrorCode.RetryAfter,
                params: { seconds: 5, reason: "ECONNRESET" },
                cause: failure,
            })

            expect(claims.fail).toHaveBeenCalledWith({ jobId: "j-1", expectedFencingToken: 2, reason: "provider down" })
            expect(logger.error).toHaveBeenCalledWith(JobsLogEvent.DeliveryFailed, failure, { jobId: "j-1" })
            expect(claims.park).not.toHaveBeenCalled()
            expect(deadLetters.raise).not.toHaveBeenCalled()
            expect(processor.onFailed).not.toHaveBeenCalled()
            expect(states.changed).toHaveBeenLastCalledWith(processor, job, { kind: "retry", attempt: 1, afterSeconds: 5 })
        })

        it.each([
            [1, 5],
            [2, 10],
            [3, 20],
        ])("pauses the background ladder after start %i by %i seconds", async (attempt, seconds) => {
            const { runner, claims, processor } = await build()
            claims.claim.mockResolvedValue(job)
            processor.process.mockRejectedValue(transient())

            await expect(runner.run(processor, { ...delivery, attempt })).rejects.toMatchObject({
                code: QueueErrorCode.RetryAfter,
                params: { seconds },
            })
        })

        it.each([
            [1, 60],
            [2, 120],
            [3, 240],
            [4, 480],
        ])("pauses the waited ladder of a job that declares it after start %i by %i seconds", async (attempt, seconds) => {
            const { runner, claims } = await build()
            claims.claim.mockResolvedValue(job)
            const processor = processorOf({ definition: MAIL_JOB })
            processor.process.mockRejectedValue(transient())

            await expect(runner.run(processor, { ...delivery, attempt })).rejects.toMatchObject({
                code: QueueErrorCode.RetryAfter,
                params: { seconds },
            })
            expect(claims.park).not.toHaveBeenCalled()
        })
    })
})

describe("JobRunnerService", () => {
    describe("a transient failure, recorded", () => {
        it("judges a failure that names a retry pause as transient and still uses the ladder's pause", async () => {
            const { runner, claims, processor } = await build()
            claims.claim.mockResolvedValue(job)
            processor.process.mockRejectedValue(
                new QueueError({ code: QueueErrorCode.RetryAfter, params: { seconds: 30 } }),
            )

            await expect(runner.run(processor, delivery)).rejects.toMatchObject({
                code: QueueErrorCode.RetryAfter,
                params: { seconds: 5 },
            })
            expect(claims.park).not.toHaveBeenCalled()
        })

        it("still hands the delivery back when recording the failure is fenced out or fails", async () => {
            const { runner, claims, logger, processor } = await build()
            claims.claim.mockResolvedValue(job)
            processor.process.mockRejectedValue(transient())
            claims.fail.mockRejectedValueOnce(fenced())

            await expect(runner.run(processor, delivery)).rejects.toMatchObject({ code: QueueErrorCode.RetryAfter })
            expect(logger.warn).toHaveBeenCalledWith(JobsLogEvent.FencedOut, { jobId: "j-1" })

            const storeDown = new Error("store down")
            claims.fail.mockRejectedValueOnce(storeDown)

            await expect(runner.run(processor, delivery)).rejects.toMatchObject({ code: QueueErrorCode.RetryAfter })
            expect(logger.error).toHaveBeenCalledWith(JobsLogEvent.FailureNotRecorded, storeDown, { jobId: "j-1" })
        })
    })
})
