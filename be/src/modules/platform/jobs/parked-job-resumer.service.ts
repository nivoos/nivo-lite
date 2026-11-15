import { Injectable, type OnApplicationBootstrap } from "@nestjs/common"
import { LessThan, Not, type EntityManager, type FindOptionsWhere } from "typeorm"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { callDbFunction } from "@modules/platform/database"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { InjectQueueOutbox, type QueueOutbox } from "@modules/platform/queue"
import { eachInOrder, fieldTextOrNullOf } from "@modules/platform/primitives"
import { JobsError, JobsErrorCode } from "./errors/jobs.error"
import { PARKED_JOBS_SWEEP } from "./jobs.contracts"
import { InjectJobsManagers, InjectJobsOptions } from "./jobs.decorators"
import { JobsLogEvent } from "./jobs.log-events"
import type { JobsOptions } from "./jobs.options"
import { ParkedJobCloseService } from "./parked-job-close.service"
import { isClosedError, resumeKeyOf } from "./parked-job-resume.policy"
import { JobProgressService } from "./job-progress.service"
import { JobEntity } from "./persistence/entities"

/** The most parked jobs one resume pass hands back; the next sweep takes the rest. */
export const RESUME_BATCH = 100

/** How many times the sweep hands a transient dead letter back by itself; after that only a person or a new build does. */
export const AUTO_RESUMES = 3

/** Who hands a job back: the machine (sweep, new build) keeps the episode and its item; a person opens a new episode. */
type ResumedBy = "machine" | "person"

/** What a person's door finds at a job id of a workspace. */
export type ParkedJobState = "parked" | "closed" | "other" | "missing"

/** The workspace a payload names, so the resumed delivery counts against the same workspace limit; null when it names none. */
const workspaceOf = (payload: object): string | null =>
    fieldTextOrNullOf(Object.entries(payload).find(([key]) => key === "workspaceId")?.[1])

@Injectable()
/**
 * Hands parked jobs back to their queue (BE-JOBS-7). A parked job is written to the queue outbox again under `<jobKey>:r<n>` and its
 * row takes the new delivery's key, so the delivery claims the SAME row: the recorded steps stay, the fencing token is bumped, and every
 * effect key (`<jobId>:<step>`) is the one the first run used, so a remote effect is never made twice. It runs at boot for jobs parked
 * under another build, on the sweep tick for every parked job, and on demand for one job. A parked job a person decided should never
 * run again is closed instead (`close`).
 */
export class ParkedJobResumerService implements OnApplicationBootstrap {
    constructor(
        @InjectJobsManagers() private readonly managers: ReadonlyArray<EntityManager>,
        @InjectJobsOptions() private readonly options: JobsOptions,
        @InjectQueueOutbox() private readonly outbox: QueueOutbox,
        @InjectLogger() private readonly logger: Logger,
        private readonly closer: ParkedJobCloseService,
        private readonly progress: JobProgressService,
        @InjectClock() private readonly clock: Clock,
    ) {}

    /**
     * Asks, through the queue outbox, for the jobs parked under a build other than this one to be handed back: the request is one
     * sweep delivery keyed by the build, so the replicas of a deployment write it once. Resuming itself runs in the sweep consumer.
     */
    async onApplicationBootstrap(): Promise<void> {
        const build = this.options.buildId
        if (build === undefined) return
        await this.writer().transaction((tx) =>
            this.outbox.write(
                tx,
                PARKED_JOBS_SWEEP.queue,
                { build },
                {
                    job: PARKED_JOBS_SWEEP.job,
                    dedupeKey: `${PARKED_JOBS_SWEEP.job}:boot:${build}`,
                },
            ),
        )
    }

    /**
     * Runs one sweep delivery. A payload that names a job is a person's "resume now" written through the outbox. A payload that names a build hands back every job parked under another build (the cause may be fixed).
     * The tick hands back only TRANSIENT dead letters, each at most `AUTO_RESUMES` times: a dead letter of class input, code or config
     * waits for a person or a new build. Neither raises a new item: the episode's one item stands until a person resumes.
     */
    sweep(payload: object): Promise<number> {
        const field = (name: string): string | null =>
            fieldTextOrNullOf(Object.entries(payload).find(([key]) => key === name)?.[1])
        const jobId = field("jobId")
        if (jobId !== null) return this.resume(jobId)
        const build = field("build")
        return build === null
            ? this.resumeWhere({ failureClass: "transient", resumeCount: LessThan(AUTO_RESUMES) }, "machine")
            : this.resumeWhere({ parkedBuild: Not(build) }, "machine")
    }

    /** Hands back every transient dead letter the sweep may still retry by itself; answers how many went back. */
    resumeAll(): Promise<number> {
        return this.sweep({})
    }

    /** Hands back one parked job on a person's word ("resume now"); a new park after it raises a new item. 0 for an id not parked. */
    resume(jobId: string): Promise<number> {
        return this.resumeWhere({ id: jobId }, "person")
    }

    /**
     * What a person's door finds at a job id of a workspace: `parked` (it can be resumed or closed), `closed` (a person closed it for
     * good), `other` (it exists in the workspace and is not stopped: running, queued, done or handed back) or `missing` (no such job of
     * this workspace: another workspace's job answers exactly like an id that never existed).
     */
    async stateOf(workspaceId: string, jobId: string): Promise<ParkedJobState> {
        const row = await this.writer()
            .createQueryBuilder(JobEntity, "job")
            .select(["job.id", "job.status", "job.error"])
            .where("job.id = :jobId AND job.payload ->> 'workspaceId' = :workspaceId", { jobId, workspaceId })
            .getOne()
        if (row === null) return "missing"
        if (row.status === "failed_awaiting_fix") return "parked"
        return row.status === "failed" && isClosedError(row.error) ? "closed" : "other"
    }

    /**
     * Closes one parked job for good with a reason (the opposite of `resume`): it becomes `failed`, which no sweep hands back, and its
     * remaining steps never run. False for an id that is not parked: nothing is changed. A closed job tells the chain's progress stream
     * its end (a `closed` frame), so a subscriber that last saw it parked or waiting does not keep showing that.
     */
    async close(jobId: string, reason: string): Promise<boolean> {
        if (!(await this.closer.close(this.writer(), jobId, reason))) return false
        await this.tellClosed(jobId)
        return true
    }

    /** Publishes the `closed` frame of the job to the chain its row recorded; a job with no recorded chain tells nothing. Never throws (a view of the row). */
    private async tellClosed(jobId: string): Promise<void> {
        try {
            const row = await this.writer().findOne(JobEntity, { select: { id: true, kind: true, progressTopic: true }, where: { id: jobId } })
            if (row === null || row.progressTopic === null) return
            await this.progress.publishTo({
                topicName: row.progressTopic,
                job: { jobId },
                jobName: row.kind,
                state: "closed",
                change: {},
                at: this.clock.now(),
            })
        } catch (cause) {
            this.logger.error(JobsLogEvent.ProgressNotTold, cause, { jobId })
        }
    }

    private async resumeWhere(where: FindOptionsWhere<JobEntity>, by: ResumedBy): Promise<number> {
        const manager = this.writer()
        const parked = await manager.find(JobEntity, {
            select: { id: true },
            where: { ...where, status: "failed_awaiting_fix" },
            order: { parkedAt: "ASC" },
            take: RESUME_BATCH,
        })
        let resumed = 0
        await eachInOrder(parked, async ({ id }) => {
            if (await this.resumeOne(manager, id, by)) resumed += 1
        })
        return resumed
    }

    /** Hands one job back in one transaction; false when another replica did it first. */
    private resumeOne(manager: EntityManager, id: string, by: ResumedBy): Promise<boolean> {
        return manager.transaction(async (tx) => {
            const job = await tx
                .createQueryBuilder(JobEntity, "job")
                .where("job.id = :id AND job.status = :parked", { id, parked: "failed_awaiting_fix" })
                .setLock("pessimistic_write")
                .setOnLocked("skip_locked")
                .getOne()
            const queue = job?.queue ?? null
            if (job === null || queue === null) return false
            const resumeCount = job.resumeCount + 1
            const [minted] = await callDbFunction<{ readonly job_enqueue: string }>(tx, "public.job_enqueue", [
                workspaceOf(job.payload),
                queue,
                job.kind,
                JSON.stringify(job.payload),
                resumeKeyOf(job.jobKey, resumeCount),
            ])
            if (minted === undefined)
                throw new JobsError({ code: JobsErrorCode.ResumeNotQueued, params: { jobId: id } })
            await tx.update(
                JobEntity,
                { id },
                {
                    jobKey: minted.job_enqueue,
                    status: "failed",
                    resumeCount,
                    failureClass: null,
                    parkedBuild: null,
                    parkedAt: null,
                    ...(by === "person" ? { alertedAt: null } : {}),
                    error: null,
                },
            )
            this.logger.info(JobsLogEvent.Resumed, { jobId: id, resumeCount })
            return true
        })
    }

    private writer(): EntityManager {
        const [manager] = this.managers
        if (manager === undefined) throw new JobsError({ code: JobsErrorCode.ConnectionMissing })
        return manager
    }
}
