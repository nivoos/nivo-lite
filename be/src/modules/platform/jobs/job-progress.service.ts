import { Injectable, Optional } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { returnedRows, rowShape } from "@modules/platform/database"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { InjectRealtimeHub, type RealtimeHub } from "@modules/platform/realtime"
import { JobsError, JobsErrorCode } from "./errors/jobs.error"
import type { ClaimedJob } from "./jobs.contracts"
import { InjectJobsManagers } from "./jobs.decorators"
import { JobsLogEvent } from "./jobs.log-events"
import type { JobProgress } from "./job-progress.port"
import {
    jobProgressFrameId,
    jobProgressTopic,
    jobProgressTopicOfName,
    type JobProgressFrame,
} from "./job-progress.policy"
import { JobEntity } from "./persistence/entities"

/** The columns a step report answers: the kind of the job and the topic its row records. */
const REPORT_COLUMNS = "kind, progress_topic"

/** The guard of the row a step report returns. */
const isReportedRow = rowShape({ kind: "string", progress_topic: "string?" })

/** What a frame of one change carries besides the job and the time. */
export type JobProgressChange = Partial<
    Pick<JobProgressFrame, "attempt" | "retryAt" | "failureClass" | "done" | "total" | "labelKey">
>

/** One frame to publish: the job it tells, the topic it goes to, its state, what the change carries and when it happened. */
export interface JobProgressPublication {
    /** The recorded chain name of the job (`job-progress:<workspace>:<root>`): its workspace is the topic the frame goes to, its root is carried in the frame. */
    readonly topicName: string
    /** The job the frame tells (a claimed job, or the row of a job a person closed). */
    readonly job: Pick<ClaimedJob, "jobId">
    /** The job name (the kind of the job row). */
    readonly jobName: string
    /** The state the job is in. */
    readonly state: JobProgressFrame["state"]
    /** What the change carries besides the job and the time. */
    readonly change: JobProgressChange
    /** When the change happened. */
    readonly at: Date
}

@Injectable()
/**
 * Step progress of a job and the one place a job's progress frame is published. A report is written on the job row under the claim's
 * fencing token (so it survives a crash and a zombie's report is refused) and then published after it committed; a frame that cannot
 * be published is logged and the job goes on exactly as with nobody listening. An app with no hub stores the numbers only.
 */
export class JobProgressService implements JobProgress {
    constructor(
        @InjectJobsManagers() private readonly managers: ReadonlyArray<EntityManager>,
        @InjectClock() private readonly clock: Clock,
        @InjectLogger() private readonly logger: Logger,
        @Optional() @InjectRealtimeHub() private readonly hub?: RealtimeHub,
    ) {}

    /** Stores the step numbers on the row (fenced) and publishes them to the topic the row recorded, when it recorded one. */
    async report(job: ClaimedJob, done: number, total: number, labelKey: string): Promise<void> {
        const at = this.clock.now()
        const result = await this.writer()
            .createQueryBuilder(JobEntity, "jobs")
            .update()
            .set({ progressDone: done, progressTotal: total, progressLabel: labelKey, progressAt: at })
            .where("id = :id AND fencing_token = :token AND status = :running", {
                id: job.jobId,
                token: job.fencingToken,
                running: "running",
            })
            .returning(REPORT_COLUMNS)
            .execute()
        const [row] = returnedRows(result.raw, isReportedRow)
        if (row === undefined) {
            throw new JobsError({
                code: JobsErrorCode.FencedOut,
                params: { jobId: job.jobId, token: job.fencingToken },
            })
        }
        if (row.progress_topic === null) return
        await this.publishTo({ topicName: row.progress_topic, job, jobName: row.kind, state: "running", change: { done, total, labelKey }, at })
    }

    /** Records the chain name of the job on its row (fenced) and clears a stale retry time; the row is what a late subscriber and a step report read it from. */
    async record(job: ClaimedJob, topicName: string): Promise<void> {
        await this.writer()
            .createQueryBuilder(JobEntity, "jobs")
            .update()
            .set({ progressTopic: topicName, progressRetryAt: null })
            .where("id = :id AND fencing_token = :token AND status = :running", {
                id: job.jobId,
                token: job.fencingToken,
                running: "running",
            })
            .execute()
    }

    /**
     * Stores when the retry of a failed job runs again, so a late subscriber's snapshot of the waiting job tells it. The runner has
     * released the claim by now, so the write is guarded by the status (a job already running again is left alone), not by the token.
     */
    async recordRetry(job: ClaimedJob, retryAt: Date): Promise<void> {
        await this.writer()
            .createQueryBuilder(JobEntity, "jobs")
            .update()
            .set({ progressRetryAt: retryAt })
            .where("id = :id AND status = :failed", { id: job.jobId, failed: "failed" })
            .execute()
    }

    /** Publishes one frame of a state change once, to the topic of the workspace the chain name belongs to; never throws. */
    async publishTo(publication: JobProgressPublication): Promise<void> {
        const { topicName, job, jobName, state, change, at } = publication
        if (this.hub === undefined) return
        const chain = jobProgressTopicOfName(topicName)
        if (chain === undefined) {
            this.logger.error(JobsLogEvent.ProgressNotPublished, new Error("the recorded progress topic is not a chain name"), {
                jobId: job.jobId,
                topic: topicName,
            })
            return
        }
        const iso = at.toISOString()
        const frame: JobProgressFrame = {
            id: jobProgressFrameId({ jobId: job.jobId, state, attempt: change.attempt, done: change.done, at: iso }),
            kind: "job",
            root: chain.root,
            job: jobName,
            jobId: job.jobId,
            state,
            at: iso,
            ...change,
        }
        try {
            await this.hub.publish(jobProgressTopic(chain.workspaceId), frame)
        } catch (cause) {
            this.logger.error(JobsLogEvent.ProgressNotPublished, cause, { jobId: job.jobId, topic: topicName })
        }
    }

    /** The entity manager of the connection that holds the job table. */
    private writer(): EntityManager {
        const [manager] = this.managers
        if (manager === undefined) throw new JobsError({ code: JobsErrorCode.ConnectionMissing })
        return manager
    }
}
