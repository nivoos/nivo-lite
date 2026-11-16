import { Injectable } from "@nestjs/common"
import { BrainCommandRunnerService, BrainLogEvent } from "@modules/domain/brain"
import { AdvancingJobStepPolicy, InjectJobClaims, type ClaimedJob, type JobClaims, type JobStep } from "@modules/platform/jobs"
import { InjectLogger, type Logger } from "@modules/platform/logging"

@Injectable()
/** The one effect of the job: the command of the claimed job is carried out and its row closed (or the upkeep it names is done). */
export class RunCommandStep extends AdvancingJobStepPolicy implements JobStep {
    constructor(
        private readonly runner: BrainCommandRunnerService,
        @InjectJobClaims() claims: JobClaims,
        @InjectLogger() private readonly logger: Logger,
    ) {
        super(claims, "command")
    }

    /** Runs the command after the worker's claim has been checked. */
    protected async perform(_payload: object, job: ClaimedJob): Promise<unknown> {
        const outcome = await this.runner.run(job)
        this.logger.info(BrainLogEvent.CommandRan, { jobId: job.jobId, outcome })
        return outcome
    }
}
