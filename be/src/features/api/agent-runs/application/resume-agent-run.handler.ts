import { CommandHandler } from "@nestjs/cqrs"
import { AgentRunCancelService, type OwnerPauseAnswer } from "@modules/domain/agent-runs"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { ResumeAgentRunCommand } from "./resume-agent-run.command"

@CommandHandler(ResumeAgentRunCommand)
/** Resumes a run a person paused, through the run door (owner or manager). */
export class ResumeAgentRunHandler extends ICQRSHandler<ResumeAgentRunCommand, OwnerPauseAnswer> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly door: AgentRunCancelService,
    ) {
        super(logger)
    }

    protected override process(command: ResumeAgentRunCommand): Promise<OwnerPauseAnswer> {
        return this.door.resume({ principalId: command.params.principal.id, ...command.params.request })
    }
}
