import { Injectable } from "@nestjs/common"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import {
    classifyFailure,
    deferSecondsOf,
    InjectQueueWorkerRegistry,
    retryAfterSecondsOf,
    SCHEDULE_ATTEMPTS,
    workspaceOf,
    QueueError,
    QueueErrorCode,
    type QueueDelivery,
    type QueueHandler,
    type QueueWorkerRegistry,
} from "@modules/platform/queue"
import { JobsError, JobsErrorCode } from "./errors/jobs.error"
import type { ClaimedJob, ParkWrite } from "./jobs.contracts"
import { InjectJobClaims, InjectJobsOptions } from "./jobs.decorators"
import { JobsLogEvent } from "./jobs.log-events"
import type { JobsOptions } from "./jobs.options"
import type { JobClaims, JobProcessorRegistry } from "./jobs.port"
import { JobDeadLettersService } from "./job-dead-letters.service"
import { failureReasonOf } from "./job-failure-reason.policy"
import { isPastLadder, JOB_LADDERS, ladderVerdictOf, type JobLadder } from "./job-ladders.policy"
import { JobRenewalService } from "./job-renewal.service"
import { JobStateEventsService } from "./job-state-events.service"
import type { FencedProcessor } from "./fenced.processor"

const isFencedOut = (cause: unknown): boolean => cause instanceof JobsError && cause.code === JobsErrorCode.FencedOut

/** The fair group of a processor's jobs as the queue asks for it (job name and payload), or nothing when it declares none. */
const groupOfProcessor = (processor: FencedProcessor): QueueHandler["fairGroupOf"] => {
    const own = processor.fairGroupOf
    return own === undefined ? undefined : (_job, payload) => own.call(processor, payload)
}

/**
 * The starts of a job fired by a job scheduler (no outbox row stands behind it): the broker's own tries, `SCHEDULE_ATTEMPTS`; the broker
 * waits between them (its backoff), so no pause is declared. A permanent failure, or a transient one on the last start, is dead-lettered
 * like any job's: the scheduler goes on with its next slot, and the person is told once for this one.
 */
const SCHEDULED_LADDER: JobLadder = { starts: SCHEDULE_ATTEMPTS, pausesSeconds: [] }

/** The ladder of a processor: the one its job's declaration names, else the background ladder. */
const ladderOf = (processor: FencedProcessor): JobLadder => JOB_LADDERS[processor.definition?.ladder ?? "background"]

/** A refusal of the payload by the job's declaration: the input is wrong, so it is a dead letter at once. */
const payloadRefused = (job: string): QueueError =>
    new QueueError({ code: QueueErrorCode.FlowFailure, params: { failureClass: "input", reason: `payload refused: ${job}` } })

@Injectable()
/**
 * The runner of fenced jobs and the ONE place a job failure is judged. For every delivery it claims the job (bumping the fencing token),
 * checks the payload against the job's declaration, calls the processor and settles the job through the guarded writes. A failure is
 * classified by `classifyFailure`: a transient one with starts left on the job's ladder is failed and handed to the queue with the
 * ladder's pause; any other class, a transient failure on the last start, or a delivery already started more often than its ladder
 * allows (each earlier start died without settling: a crash) is a DEAD LETTER: the job row parks `failed_awaiting_fix` and ONE item goes
 * to a person through the bound dead-letter target; the delivery itself is then acknowledged. A `JobFencedOut` means a newer worker owns
 * the job: this worker stops with no further effect. A handler that asked to run later is released without a failure.
 */
export class JobRunnerService implements JobProcessorRegistry {
    constructor(
        @InjectJobsOptions() private readonly options: JobsOptions,
        @InjectJobClaims() private readonly claims: JobClaims,
        @InjectQueueWorkerRegistry() private readonly queues: QueueWorkerRegistry,
        @InjectLogger() private readonly logger: Logger,
        private readonly renewals: JobRenewalService,
        private readonly deadLetters: JobDeadLettersService,
        private readonly states: JobStateEventsService,
    ) {}

    /** Subscribes the processor to its queue and job. */
    add(processor: FencedProcessor): void {
        this.queues.add({
            queue: processor.queue,
            job: processor.job ?? processor.definition?.name,
            concurrency: processor.concurrency,
            scheduled: processor.scheduled,
            workspaceHeadroom: processor.workspaceHeadroom,
            fairGroupOf: groupOfProcessor(processor),
            handle: (delivery) => this.run(processor, delivery),
            failed: (delivery, cause) => processor.onFailed(delivery, cause),
        })
    }

    /** Runs one delivery of the processor's queue. */
    async run(processor: FencedProcessor, delivery: QueueDelivery): Promise<void> {
        const job = await this.claims.claim({
            kind: processor.job ?? processor.definition?.name ?? processor.queue,
            jobKey: delivery.id,
            payload: delivery.payload,
            workerId: this.options.workerId,
            leaseMs: this.options.leaseMs,
        })
        if (job === null) {
            const seconds = await this.claims.retryAfterSeconds(delivery.id)
            if (seconds !== null) {
                throw new QueueError({
                    code: QueueErrorCode.DeferredUntil,
                    params: { job: delivery.job, seconds },
                })
            }
            return
        }
        const ladder = ladderOf(processor)
        if (processor.scheduled !== true && isPastLadder(ladder, delivery.attempt)) {
            return this.deadLetter(processor, delivery, job, "transient", "crashed: started past its ladder")
        }
        await this.states.changed(processor, job, { kind: "running", attempt: delivery.attempt })
        const hold = this.renewals.keep(job)
        try {
            const definition = processor.definition
            if (definition !== undefined && !definition.payload(job.payload)) throw payloadRefused(definition.name)
            await processor.process(job)
            await this.claims.complete({ jobId: job.jobId, expectedFencingToken: job.fencingToken })
            await this.states.changed(processor, job, { kind: "done" })
        } catch (cause) {
            const verdict = await this.failed(processor, delivery, job, ladder, cause)
            if (verdict === "rethrow") throw cause
            if (verdict !== "settled") throw verdict
        } finally {
            hold.stop()
        }
    }

    /**
     * Settles a failed delivery and answers what the delivery does next: `settled` (fenced out, or dead-lettered: acknowledged),
     * `rethrow` (deferred, or retried by the broker's own pause: the cause goes back to the queue) or the `RetryAfter` error that hands it
     * back with the ladder's pause.
     */
    private async failed(
        processor: FencedProcessor,
        delivery: QueueDelivery,
        job: ClaimedJob,
        ladder: JobLadder,
        cause: unknown,
    ): Promise<"settled" | "rethrow" | QueueError> {
        if (isFencedOut(cause)) {
            this.logger.warn(JobsLogEvent.FencedOut, { jobId: job.jobId })
            return "settled"
        }
        const deferSeconds = deferSecondsOf(cause)
        if (deferSeconds !== undefined) {
            await this.release(job, deferSeconds)
            return "rethrow"
        }
        const failureClass = retryAfterSecondsOf(cause) === undefined ? classifyFailure(cause) : "transient"
        const scheduled = processor.scheduled === true
        const verdict = ladderVerdictOf(scheduled ? SCHEDULED_LADDER : ladder, delivery.attempt, failureClass === "transient")
        if (verdict.kind === "dead-letter") {
            const reason = failureReasonOf(cause)
            this.logger.error(JobsLogEvent.DeadLettered, cause, { jobId: job.jobId, failureClass, why: verdict.why, reason })
            await this.deadLetter(processor, delivery, job, failureClass, reason, cause)
            return "settled"
        }
        const afterSeconds = scheduled ? 0 : verdict.afterSeconds
        await this.recordFailure(job, cause)
        await this.states.changed(processor, job, { kind: "retry", attempt: delivery.attempt, afterSeconds })
        if (afterSeconds <= 0) return "rethrow"
        return new QueueError({
            code: QueueErrorCode.RetryAfter,
            params: { seconds: afterSeconds, reason: failureReasonOf(cause) },
            cause,
        })
    }

    /**
     * Parks the job as a dead letter under the claim's token and raises its ONE item (keyed by job and park episode), then runs the
     * processor's failure hook once so the domain row a person sees says the work stopped. A park refused by the fence is a newer
     * worker's job: nothing more is done. An item that cannot be raised is logged; the job stays parked and a person still finds it.
     */
    private async deadLetter(
        processor: FencedProcessor,
        delivery: QueueDelivery,
        job: ClaimedJob,
        failureClass: ParkWrite["failureClass"],
        reason: string,
        cause?: unknown,
    ): Promise<void> {
        const build = this.options.buildId ?? "unknown"
        let due: boolean
        try {
            due = await this.claims.park({
                jobId: job.jobId,
                expectedFencingToken: job.fencingToken,
                failureClass,
                reason,
                build,
                queue: processor.queue,
            })
        } catch (cause) {
            if (isFencedOut(cause)) {
                this.logger.warn(JobsLogEvent.FencedOut, { jobId: job.jobId })
                return
            }
            throw cause
        }
        await this.states.changed(processor, job, { kind: "dead-letter", failureClass })
        await processor.onFailed(delivery, new QueueError({ code: QueueErrorCode.FlowFailure, params: { failureClass, reason }, cause }))
        if (!due) return
        const workspaceId = workspaceOf(job.payload) ?? undefined
        await this.deadLetters
            .raise({
                kind: "flow-parked",
                jobId: job.jobId,
                workspaceId,
                flowKind: job.kind,
                failureClass,
                reason,
                episode: job.resumeCount ?? 0,
                correlationId: delivery.id,
                build,
                action: "resume",
            })
            .catch((error_: unknown) => {
                this.logger.error(JobsLogEvent.DeadLetterNotRaised, error_, { jobId: job.jobId })
            })
    }

    /** A handler that asked to run later failed nothing: the job is given back, logged at info, and the queue defers it. */
    private async release(job: ClaimedJob, seconds: number): Promise<void> {
        this.logger.info(JobsLogEvent.Deferred, { jobId: job.jobId, seconds })
        await this.claims
            .release({ jobId: job.jobId, expectedFencingToken: job.fencingToken })
            .catch((error_: unknown) => {
                if (isFencedOut(error_)) this.logger.warn(JobsLogEvent.FencedOut, { jobId: job.jobId })
                else this.logger.error(JobsLogEvent.FailureNotRecorded, error_, { jobId: job.jobId })
            })
    }

    private async recordFailure(job: ClaimedJob, cause: unknown): Promise<void> {
        const reason = failureReasonOf(cause)
        this.logger.error(JobsLogEvent.DeliveryFailed, cause, { jobId: job.jobId })
        await this.claims
            .fail({ jobId: job.jobId, expectedFencingToken: job.fencingToken, reason })
            .catch((error_: unknown) => {
                if (isFencedOut(error_)) this.logger.warn(JobsLogEvent.FencedOut, { jobId: job.jobId })
                else this.logger.error(JobsLogEvent.FailureNotRecorded, error_, { jobId: job.jobId })
            })
    }
}
