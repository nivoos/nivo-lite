import { CommandHandler } from "@nestjs/cqrs"
import { StoppedWorkService } from "@modules/domain/job-ops"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { CloseStoppedWorkCommand } from "./close-stopped-work.command"

@CommandHandler(CloseStoppedWorkCommand)
/** Closes a stopped job through one domain-service call that checks the caller owns the workspace of the job. */
export class CloseStoppedWorkHandler extends ICQRSHandler<CloseStoppedWorkCommand, boolean> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly stopped: StoppedWorkService,
    ) {
        super(logger)
    }

    protected override process(command: CloseStoppedWorkCommand): Promise<boolean> {
        return this.stopped.close(
            command.params.principal.id,
            command.params.request.workspaceId,
            command.params.request.jobId,
            command.params.request.reason,
        )
    }
}
