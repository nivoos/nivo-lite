import { Injectable, type OnModuleInit } from "@nestjs/common"
import { TeamChatNoticesService } from "@modules/domain/team-chat"
import { InjectErrorReporter, type ErrorReporter } from "@modules/platform/errors"
import {
    InjectJobDeadLetters,
    type FlowAlerts,
    type JobDeadLettersService,
    type ParkedFlowAlert,
} from "@modules/platform/jobs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { JobOpsLogEvent } from "./job-ops.log-events"

@Injectable()
/**
 * Tells the founder when a job parks for a fix (BE-JOBS-8): it binds itself to the dead-letter registry when its module starts (the
 * registry exists so the jobs platform never holds this capability in a constructor), and each alert becomes ONE `job.parked` card in
 * the founder's NIVO room, keyed by the job and the park episode, so a repeat of the same episode writes nothing. A job that names no
 * workspace has no founder to tell: it is recorded as an app error (the operator resumes it with `cli queues resume`).
 */
export class JobParkedAlertsService implements FlowAlerts, OnModuleInit {
    constructor(
        @InjectJobDeadLetters() private readonly deadLetters: JobDeadLettersService,
        private readonly notices: TeamChatNoticesService,
        @InjectErrorReporter() private readonly reporter: ErrorReporter,
        @InjectLogger() private readonly logger: Logger,
    ) {}

    /** Binds to the dead-letter registry. */
    onModuleInit(): void {
        this.deadLetters.bind(this)
    }

    /** Posts the card of one parked job, or records an app error when the job has no workspace; a workspace with no owner is logged. */
    async raise(alert: ParkedFlowAlert): Promise<void> {
        if (alert.workspaceId === undefined) {
            await this.reporter.report("job.parked", new Error(`job ${alert.flowKind} parked: ${alert.reason}`), {
                jobId: alert.jobId,
                job: alert.flowKind,
                failureClass: alert.failureClass,
                episode: alert.episode,
            })
            return
        }
        const posted = await this.notices.postJobParked(alert.workspaceId, {
            jobId: alert.jobId,
            job: alert.flowKind,
            failureClass: alert.failureClass,
            reason: alert.reason,
            episode: alert.episode,
        })
        if (posted === "no_owner")
            this.logger.warn(JobOpsLogEvent.ParkedCardFailed, { jobId: alert.jobId, workspaceId: alert.workspaceId })
    }
}
