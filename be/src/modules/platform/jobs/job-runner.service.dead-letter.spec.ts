import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { QUEUE_WORKER_REGISTRY, QueueError, QueueErrorCode, SCHEDULE_ATTEMPTS } from "@modules/platform/queue"
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
    describe("a dead letter on the last start", () => {
        it("parks a transient failure on the last start, raises its one item, runs onFailed once and acknowledges the delivery", async () => {
            const { runner, claims, deadLetters, states, logger, processor } = await build()
            claims.claim.mockResolvedValue({ ...job, resumeCount: 0 })
            processor.process.mockRejectedValue(transient())
            const last = { ...delivery, attempt: 4 }

            await expect(runner.run(processor, last)).resolves.toBeUndefined()

            expect(claims.park).toHaveBeenCalledWith({
                jobId: "j-1",
                expectedFencingToken: 2,
                failureClass: "transient",
                reason: "Error ECONNRESET: provider down",
                build: "unknown",
                queue: "mail",
            })
            expect(processor.onFailed).toHaveBeenCalledTimes(1)
            expect(processor.onFailed).toHaveBeenCalledWith(
                last,
                expect.objectContaining({
                    code: QueueErrorCode.FlowFailure,
                    params: { failureClass: "transient", reason: "Error ECONNRESET: provider down" },
                }),
            )
            expect(deadLetters.raise).toHaveBeenCalledWith({
                kind: "flow-parked",
                jobId: "j-1",
                workspaceId: undefined,
                flowKind: "mail",
                failureClass: "transient",
                reason: "Error ECONNRESET: provider down",
                episode: 0,
                correlationId: "k-1",
                build: "unknown",
                action: "resume",
            })
            expect(states.changed).toHaveBeenLastCalledWith(processor, expect.anything(), {
                kind: "dead-letter",
                failureClass: "transient",
            })
            expect(claims.fail).not.toHaveBeenCalled()
            expect(logger.error).toHaveBeenCalledWith(JobsLogEvent.DeadLettered, expect.anything(), {
                jobId: "j-1",
                failureClass: "transient",
                why: "exhausted",
                reason: "Error ECONNRESET: provider down",
            })
        })

        it("parks a transient failure on the last start of the waited ladder, not before", async () => {
            const { runner, claims } = await build()
            claims.claim.mockResolvedValue(job)
            const processor = processorOf({ definition: MAIL_JOB })
            processor.process.mockRejectedValue(transient())

            await expect(runner.run(processor, { ...delivery, attempt: 4 })).rejects.toMatchObject({
                code: QueueErrorCode.RetryAfter,
            })
            await expect(runner.run(processor, { ...delivery, attempt: 5 })).resolves.toBeUndefined()

            expect(claims.park).toHaveBeenCalledTimes(1)
        })
    })
})

describe("JobRunnerService", () => {
    describe("a dead letter of any class", () => {
        it.each([
            ["input", refused("input")],
            ["config", refused("config")],
            ["code", new Error("a bug")],
        ])("parks a %s failure at once, on the first start", async (failureClass, failure) => {
            const { runner, claims, deadLetters, processor } = await build()
            claims.claim.mockResolvedValue(job)
            processor.process.mockRejectedValue(failure)

            await expect(runner.run(processor, delivery)).resolves.toBeUndefined()

            expect(claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass }))
            expect(claims.fail).not.toHaveBeenCalled()
            expect(processor.onFailed).toHaveBeenCalledTimes(1)
            expect(deadLetters.raise).toHaveBeenCalledWith(expect.objectContaining({ failureClass }))
        })

        it("keeps the reason of a thrown value that is not an Error by its text", async () => {
            const { runner, claims, processor } = await build()
            claims.claim.mockResolvedValue(job)
            processor.process.mockRejectedValue("plain text")

            await expect(runner.run(processor, delivery)).resolves.toBeUndefined()

            expect(claims.park).toHaveBeenCalledWith(
                expect.objectContaining({ failureClass: "code", reason: "plain text" }),
            )
        })

        it("names the uncoded throw a coded failure wraps on the parked row AND on its one item: class, code, message (a person can act)", async () => {
            const { runner, claims, deadLetters, processor } = await build()
            claims.claim.mockResolvedValue(job)
            // A store adapter's driver error, wrapped by a package's coded refusal (built by another copy of the error base).
            const driver = Object.assign(new Error("permission denied for table records"), { name: "QueryFailedError", code: "42501" })
            const refusal = Object.assign(new Error("DATA_STORE_FAILED", { cause: driver }), {
                code: "DATA_STORE_FAILED",
                params: { store: "database" },
            })
            processor.process.mockRejectedValue(refusal)

            await expect(runner.run(processor, { ...delivery, attempt: 4 })).resolves.toBeUndefined()

            const reason = "DATA_STORE_FAILED (QueryFailedError 42501: permission denied for table records)"
            expect(claims.park).toHaveBeenCalledWith(expect.objectContaining({ reason }))
            expect(deadLetters.raise).toHaveBeenCalledWith(expect.objectContaining({ reason }))
        })

        it("parks a delivery started past its ladder without running it: every earlier start died without settling", async () => {
            const { runner, claims, deadLetters, renewals, processor } = await build()
            claims.claim.mockResolvedValue(job)

            await expect(runner.run(processor, { ...delivery, attempt: 5 })).resolves.toBeUndefined()

            expect(processor.process).not.toHaveBeenCalled()
            expect(renewals.keep).not.toHaveBeenCalled()
            expect(claims.complete).not.toHaveBeenCalled()
            expect(claims.park).toHaveBeenCalledWith(
                expect.objectContaining({ failureClass: "transient", reason: "crashed: started past its ladder" }),
            )
            expect(processor.onFailed).toHaveBeenCalledTimes(1)
            expect(deadLetters.raise).toHaveBeenCalledTimes(1)
        })

        it("allows the waited ladder its fifth start and parks the sixth without running it", async () => {
            const { runner, claims } = await build()
            claims.claim.mockResolvedValue(job)
            const processor = processorOf({ definition: MAIL_JOB })

            await runner.run(processor, { ...delivery, attempt: 5 })
            expect(processor.process).toHaveBeenCalledTimes(1)
            await runner.run(processor, { ...delivery, attempt: 6 })

            expect(processor.process).toHaveBeenCalledTimes(1)
            expect(claims.park).toHaveBeenCalledTimes(1)
        })
    })
})

describe("JobRunnerService", () => {
    describe("a dead letter past the ladder or refused", () => {
        it("parks a payload the job's declaration refuses as input, without running the processor", async () => {
            const { runner, claims } = await build()
            claims.claim.mockResolvedValue({ ...job, payload: { other: 1 } })
            const processor = processorOf({ definition: MAIL_JOB })

            await expect(runner.run(processor, delivery)).resolves.toBeUndefined()

            expect(processor.process).not.toHaveBeenCalled()
            expect(claims.park).toHaveBeenCalledWith(
                expect.objectContaining({ failureClass: "input", reason: "payload refused: mail.send" }),
            )
            expect(claims.complete).not.toHaveBeenCalled()
        })

        it("runs a payload the declaration accepts", async () => {
            const { runner, claims } = await build()
            claims.claim.mockResolvedValue(job)
            const processor = processorOf({ definition: MAIL_JOB })

            await runner.run(processor, delivery)

            expect(processor.process).toHaveBeenCalledWith(job)
            expect(claims.complete).toHaveBeenCalled()
        })

        it("stops when a newer worker fences out the park: no onFailed, no item", async () => {
            const { runner, claims, deadLetters, logger, processor } = await build()
            claims.claim.mockResolvedValue(job)
            processor.process.mockRejectedValue(new Error("a bug"))
            claims.park.mockRejectedValue(fenced())

            await expect(runner.run(processor, delivery)).resolves.toBeUndefined()

            expect(logger.warn).toHaveBeenCalledWith(JobsLogEvent.FencedOut, { jobId: "j-1" })
            expect(processor.onFailed).not.toHaveBeenCalled()
            expect(deadLetters.raise).not.toHaveBeenCalled()
        })
    })
})

describe("JobRunnerService", () => {
    describe("a dead letter and its item", () => {
        it("lets a park that fails for another reason fail the delivery", async () => {
            const { runner, claims, processor } = await build()
            claims.claim.mockResolvedValue(job)
            processor.process.mockRejectedValue(new Error("a bug"))
            const storeDown = new Error("store down")
            claims.park.mockRejectedValue(storeDown)

            await expect(runner.run(processor, delivery)).rejects.toBe(storeDown)
            expect(processor.onFailed).not.toHaveBeenCalled()
        })

        it("keys the item by the episode the claim answered: the times the job was handed back", async () => {
            const { runner, claims, deadLetters, processor } = await build()
            claims.claim.mockResolvedValue({ ...job, resumeCount: 2, payload: { id: "m-1", workspaceId: WS } })
            processor.process.mockRejectedValue(new Error("a bug"))

            await runner.run(processor, delivery)

            expect(deadLetters.raise).toHaveBeenCalledWith(expect.objectContaining({ episode: 2, workspaceId: WS }))
        })

        it("raises no item when the park says its alert was raised already, but still runs onFailed", async () => {
            const { runner, claims, deadLetters, processor } = await build()
            claims.claim.mockResolvedValue(job)
            claims.park.mockResolvedValue(false)
            processor.process.mockRejectedValue(new Error("a bug"))

            await expect(runner.run(processor, delivery)).resolves.toBeUndefined()

            expect(processor.onFailed).toHaveBeenCalledTimes(1)
            expect(deadLetters.raise).not.toHaveBeenCalled()
        })

        it("logs an item that cannot be raised and still acknowledges the parked delivery", async () => {
            const { runner, claims, deadLetters, logger, processor } = await build()
            claims.claim.mockResolvedValue(job)
            processor.process.mockRejectedValue(new Error("a bug"))
            const down = new Error("room down")
            deadLetters.raise.mockRejectedValue(down)

            await expect(runner.run(processor, delivery)).resolves.toBeUndefined()

            expect(logger.error).toHaveBeenCalledWith(JobsLogEvent.DeadLetterNotRaised, down, { jobId: "j-1" })
        })
    })
})

describe("JobRunnerService", () => {
    describe("a scheduled processor (fired by a job scheduler, no outbox row)", () => {
        it("keeps the broker's retry for a transient failure while starts are left: records it, rethrows the original, never parks", async () => {
            const { runner, claims, deadLetters, processor } = await build()
            claims.claim.mockResolvedValue(job)
            const scheduled = processorOf({ scheduled: true })
            const failure = transient()
            scheduled.process.mockRejectedValue(failure)

            await expect(runner.run(scheduled, { ...delivery, attempt: 1 })).rejects.toBe(failure)
            await expect(runner.run(scheduled, { ...delivery, attempt: SCHEDULE_ATTEMPTS - 1 })).rejects.toBe(failure)

            expect(scheduled.process).toHaveBeenCalledTimes(2)
            expect(claims.fail).toHaveBeenCalledTimes(2)
            expect(claims.park).not.toHaveBeenCalled()
            expect(deadLetters.raise).not.toHaveBeenCalled()
            expect(processor.onFailed).not.toHaveBeenCalled()
        })

        it("dead-letters a transient failure on the last broker try: parks, ONE item, onFailed once, and the delivery is acknowledged", async () => {
            const { runner, claims, deadLetters } = await build()
            claims.claim.mockResolvedValue({ ...job, resumeCount: 0 })
            const scheduled = processorOf({ scheduled: true })
            scheduled.process.mockRejectedValue(transient())

            await expect(runner.run(scheduled, { ...delivery, attempt: SCHEDULE_ATTEMPTS })).resolves.toBeUndefined()

            expect(claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient" }))
            expect(deadLetters.raise).toHaveBeenCalledTimes(1)
            expect(scheduled.onFailed).toHaveBeenCalledTimes(1)
            expect(claims.fail).not.toHaveBeenCalled()
        })

        it("dead-letters a failure no retry can fix on the first try, without spending the broker's tries", async () => {
            const { runner, claims, deadLetters } = await build()
            claims.claim.mockResolvedValue({ ...job, resumeCount: 0 })
            const scheduled = processorOf({ scheduled: true })
            scheduled.process.mockRejectedValue(refused("input"))

            await expect(runner.run(scheduled, { ...delivery, attempt: 1 })).resolves.toBeUndefined()

            expect(claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "input" }))
            expect(deadLetters.raise).toHaveBeenCalledTimes(1)
            expect(claims.fail).not.toHaveBeenCalled()
        })
    })
})
