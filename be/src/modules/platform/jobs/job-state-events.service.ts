import { Injectable } from "@nestjs/common"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import type { ClaimedJob } from "./jobs.contracts"
import { JobsLogEvent } from "./jobs.log-events"
import type { FencedProcessor } from "./fenced.processor"
import { jobProgressTopicName, type JobProgressState } from "./job-progress.policy"
import { JobProgressService, type JobProgressChange } from "./job-progress.service"

/** One state change of a job row, as the runner committed it: keys and numbers only. */
export type JobStateChange =
    | { readonly kind: "running"; readonly attempt: number }
    | { readonly kind: "retry"; readonly attempt: number; readonly afterSeconds: number }
    | { readonly kind: "done" }
    | { readonly kind: "dead-letter"; readonly failureClass: "transient" | "input" | "code" | "config" }

/** The frame state and the fields a runner change tells, retry time counted from `at`. */
interface FrameOfChange {
    /** The frame state the change tells. */
    readonly state: JobProgressState
    /** The fields the change carries. */
    readonly change: JobProgressChange
}

const frameOf = (change: JobStateChange, at: Date): FrameOfChange => {
    switch (change.kind) {
        case "running":
            return { state: "running", change: { attempt: change.attempt } }
        case "retry":
            return {
                state: "retry",
                change: { attempt: change.attempt, retryAt: new Date(at.getTime() + change.afterSeconds * 1000).toISOString() },
            }
        case "done":
            return { state: "done", change: {} }
        case "dead-letter":
            return { state: "dead_letter", change: { failureClass: change.failureClass } }
    }
}

@Injectable()
/**
 * Where the runner tells a committed state change of a job (running with its start, retry scheduled, done, dead letter). A job that
 * declares a progress topic (`defineJob({ progress })`) records the topic on its row when it starts running and publishes ONE frame to
 * the topic for each change, after the change committed; a job with no progress declaration publishes nothing. The stream is a view of
 * the row, never its truth: this never throws, a failure to tell is logged and the job goes on exactly as with nobody listening.
 */
export class JobStateEventsService {
    constructor(
        private readonly progress: JobProgressService,
        @InjectClock() private readonly clock: Clock,
        @InjectLogger() private readonly logger: Logger,
    ) {}

    /** Tells the change; the job's state is already committed. */
    async changed(processor: FencedProcessor, job: ClaimedJob, change: JobStateChange): Promise<void> {
        const declaration = processor.definition?.progress
        if (declaration === undefined) return
        try {
            const topicName = jobProgressTopicName(declaration.topic(job.payload))
            if (change.kind === "running") await this.progress.record(job, topicName)
            const at = this.clock.now()
            const frame = frameOf(change, at)
            if (frame.change.retryAt !== undefined) await this.progress.recordRetry(job, new Date(frame.change.retryAt))
            await this.progress.publishTo({ topicName, job, jobName: processor.definition?.name ?? job.kind, state: frame.state, change: frame.change, at })
        } catch (cause) {
            this.logger.error(JobsLogEvent.ProgressNotTold, cause, { jobId: job.jobId, kind: job.kind })
        }
    }
}
