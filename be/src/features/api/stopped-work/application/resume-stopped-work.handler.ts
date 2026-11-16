import { CommandHandler } from "@nestjs/cqrs"
import { StoppedWorkService } from "@modules/domain/job-ops"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { ResumeStoppedWorkCommand } from "./resume-stopped-work.command"

@CommandHandler(ResumeStoppedWorkCommand)
/** Hands a stopped job back through one domain-service call that checks the caller owns the workspace of the job. */
export class ResumeStoppedWorkHandler extends ICQRSHandler<ResumeStoppedWorkCommand, boolean> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly stopped: StoppedWorkService,
    ) {
        super(logger)
    }

    protected override process(command: ResumeStoppedWorkCommand): Promise<boolean> {
        return this.stopped.resume(
            command.params.principal.id,
            command.params.request.workspaceId,
            command.params.request.jobId,
        )
    }
}
